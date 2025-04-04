/**
 * Copyright 2013-2019  GenieACS Inc.
 *
 * This file is part of GenieACS.
 *
 * GenieACS is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * GenieACS is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with GenieACS.  If not, see <http://www.gnu.org/licenses/>.
 */

import { constants } from "zlib";
import Koa from "koa";
import Router from "koa-router";
import * as jwt from "jsonwebtoken";
import koaStatic from "koa-static";
import koaCompress from "koa-compress";
import koaBodyParser from "koa-bodyparser";
import koaJwt from "koa-jwt";
import * as config from "./config";
import api from "./ui/api";
import Authorizer from "./common/authorizer";
import * as logger from "./logger";
import * as localCache from "./local-cache";
import { PermissionSet } from "./types";
import { authLocal } from "./ui/api-functions";
import * as init from "./init";
import { version as VERSION } from "../package.json";
import memoize from "./common/memoize";
import cors from '@koa/cors';

declare module "koa" {
  interface Request {
    body: any;
  }
}

const koa = new Koa();
const router = new Router();

const JWT_SECRET = "coraltelecom.services.app-3be8dd5f-c66b-4b3c-88f5-b2d36c9238dd";
const JWT_COOKIE = 'session';

const getAuthorizer = memoize(
  (snapshot: string, rolesStr: string): Authorizer => {
    const roles: string[] = JSON.parse(rolesStr);
    const allPermissions = localCache.getPermissions(snapshot);
    const permissionSets: PermissionSet[] = roles.map((r) =>
      Object.values(allPermissions[r] || {})
    );
    return new Authorizer(permissionSets);
  }
);

koa.on("error", (err, ctx) => {
  setTimeout(() => {
    if (ctx?.req.aborted) return;
    throw err;
  });
});



koa.use(async (ctx, next) => {
  const configSnapshot = await localCache.getCurrentSnapshot();
  ctx.state.configSnapshot = configSnapshot;
  ctx.set("X-Config-Snapshot", configSnapshot);
  ctx.set("GenieACS-Version", VERSION);
  return next();
});

koa.use(cors());

koa.use(
  koaJwt({
    secret: JWT_SECRET,
    passthrough: true,
    cookie: 'session', 
    getToken: function(ctx) {
      if (ctx && ctx.cookies && ctx.cookies.get('session')) {
        const sessionValue = ctx.cookies.get('session');
        try {
          const sessionObject = JSON.parse(sessionValue);
          if (sessionObject && sessionObject.AuthToken) {
            return sessionObject.AuthToken;
          }
        } catch (error) {
          console.error('Error parsing session cookie:', error);
        }
      }
      return null;
    },
    isRevoked: async (ctx, decodedToken) => {
      if (decodedToken && decodedToken["authMethod"] === "local") {
        return !localCache.getUsers(ctx.state.configSnapshot)[decodedToken["username"]];
      }
      return true;
    },
  })
);

koa.use(async (ctx, next) => {
  let roles: string[] = [];

  if (ctx.state.user?.username) {
    let user;
    if (ctx.state.user.authMethod === "local") {
      user = localCache.getUsers(ctx.state.configSnapshot)[
        ctx.state.user.username
      ];
    } else {
      throw new Error("Invalid auth method");
    }
    roles = user.roles || [];
  }

  ctx.state.authorizer = getAuthorizer(
    ctx.state.configSnapshot,
    JSON.stringify(roles)
  );

  return next();
});

router.post("/checkAuth",async (ctx)=> {
  if (!JWT_SECRET) {
    ctx.status = 500;
    ctx.body = "UI_JWT_SECRET is not set";
    logger.error({ message: "UI_JWT_SECRET is not set" });
    return;
  }
  const authorizationHeader = ctx.request.headers.authorization;
  if (!authorizationHeader || !authorizationHeader.startsWith("Bearer ")) {
    ctx.status = 401;
    ctx.body = {
      error: "Authorization header missing or invalid",
      status: 0
    };
    return;
  }
  const Token = authorizationHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(Token, JWT_SECRET);
    ctx.status = 200;
    ctx.body = {
      message: "Token verified successfully",
      status: 1
    };
  } catch (error) {
    ctx.status = 401;
    ctx.body = {
      error: "Invalid token",
      status: 0,
      message: error.message
    };
  }
});

router.post("/login", async (ctx) => {
  if (!JWT_SECRET) {
    ctx.status = 500;
    ctx.body = "UI_JWT_SECRET is not set";
    logger.error({ message: "UI_JWT_SECRET is not set" });
    return;
  }

  const username = ctx.request.body.username;
  const password = ctx.request.body.password;

  const log = {
    message: "Log in",
    context: ctx,
    username: username,
    method: null,
  };

  function success(authMethod): void {
    log.method = authMethod;
    const token = jwt.sign({ username, authMethod }, JWT_SECRET, { expiresIn: '10h' });
    const tokenString = JSON.stringify(token); // Stringify the token
    const Data = {
      AuthToken: tokenString.slice(1, -1) // Remove surrounding quotes
    };
    ctx.cookies.set(JWT_COOKIE, JSON.stringify(Data), { sameSite: "lax" }); // Stringify Data before setting the cookie
    ctx.body = JSON.stringify(Data); // Stringify Data before assigning it to the response body
  }

  function failure(): void {
    ctx.status = 400;
    ctx.body = "Incorrect Username or Password";
    log.message += " failed";
    logger.accessWarn(log);
  }

  if (await authLocal(ctx.state.configSnapshot, username, password))
    return void success("local");

  failure();
});

router.post("/logout", async (ctx) => {
  ctx.cookies.set(JWT_COOKIE); // Delete cookie
  ctx.body = "";

  logger.accessInfo({
    message: "Log out",
    context: ctx,
  });
});

koa.use(async (ctx, next) => {
  if (ctx.request.type === "application/octet-stream")
    ctx.disableBodyParser = true;

  return next();
});

koa.use(koaBodyParser());
router.use("/api", api.routes(), api.allowedMethods());

router.get("/status", (ctx) => {
  ctx.body = "OK";
});

router.get("/init", async (ctx) => {
  const status = await init.getStatus();
  if (Object.keys(localCache.getUsers(ctx.state.configSnapshot)).length) {
    if (!ctx.state.authorizer.hasAccess("users", 3)) status["users"] = false;
    if (!ctx.state.authorizer.hasAccess("permissions", 3))
      status["users"] = false;
    if (!ctx.state.authorizer.hasAccess("config", 3)) {
      status["filters"] = false;
      status["device"] = false;
      status["index"] = false;
      status["overview"] = false;
    }
    if (!ctx.state.authorizer.hasAccess("presets", 3))
      status["presets"] = false;
    if (!ctx.state.authorizer.hasAccess("provisions", 3))
      status["presets"] = false;
  }

  ctx.body = status;
});

router.post("/init", async (ctx) => {
  const status = ctx.request.body;
  if (Object.keys(localCache.getUsers(ctx.state.configSnapshot)).length) {
    if (!ctx.state.authorizer.hasAccess("users", 3)) status["users"] = false;
    if (!ctx.state.authorizer.hasAccess("permissions", 3))
      status["users"] = false;
    if (!ctx.state.authorizer.hasAccess("config", 3)) {
      status["filters"] = false;
      status["device"] = false;
      status["index"] = false;
      status["overview"] = false;
    }
    if (!ctx.state.authorizer.hasAccess("presets", 3))
      status["presets"] = false;
    if (!ctx.state.authorizer.hasAccess("provisions", 3))
      status["presets"] = false;
  }
  await init.seed(status);
  ctx.body = "";
});

router.get("/", async (ctx) => {
  const permissionSets: PermissionSet[] =
    ctx.state.authorizer.getPermissionSets();

  let wizard = "";
  if (!Object.keys(localCache.getUsers(ctx.state.configSnapshot)).length)
    wizard = '<script>window.location.hash = "#!/wizard";</script>';

  ctx.body = `<!DOCTYPE html>
  <html>
    <head>
      <title>Auto Provisioning server</title>
      <link rel="shortcut icon" type="image/png" href="favicon.png" />
      <link rel="stylesheet" href="app.css">
      <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
    </head>
    <body>
    <noscript>GenieACS UI requires JavaScript to work. Please enable JavaScript in your browser.</noscript>
      <script>
        window.clientConfig = ${JSON.stringify({
          ui: localCache.getUiConfig(ctx.state.configSnapshot),
        })};
        window.configSnapshot = ${JSON.stringify(ctx.state.configSnapshot)};
        window.genieacsVersion = ${JSON.stringify(VERSION)};
        window.username = ${JSON.stringify(
          ctx.state.user ? ctx.state.user.username : ""
        )};
        window.permissionSets = ${JSON.stringify(permissionSets)};
      </script>
      <script type="module" src="app.js"></script>${wizard} 
    </body>
  </html>
  `;
});

koa.use(
  koaCompress({
    gzip: {
      flush: constants.Z_SYNC_FLUSH,
    },
    deflate: {
      flush: constants.Z_SYNC_FLUSH,
    },
    br: {
      flush: constants.BROTLI_OPERATION_FLUSH,
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 5,
      },
    },
  })
);

koa.use(router.routes());
koa.use(koaStatic(config.ROOT_DIR + "/public"));

export const listener = koa.callback();
