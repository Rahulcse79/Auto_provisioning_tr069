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

import { ClosureComponent, Component, Children } from "mithril";
import { m } from "./components";
import * as store from "./store";
import * as notifications from "./notifications";
import * as overlay from "./overlay";
import changePasswordComponent from "./change-password-component";

export function init(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  return Promise.resolve(args);
}

export const component: ClosureComponent = (): Component => {

      var statusforlogog=false;
      
      if(window.username){
        statusforlogog=true;
        
      }

     

  return {
    view: (vnode) => {
      if (window.username) m.route.set(vnode.attrs["continue"] || "/");

      document.title = "Login - Coral Application";
      return !statusforlogog && m('div', { class: 'login-page-new-logo' },
      !statusforlogog && m("div", { class: "new-logo" },m("img", { src: "logoLight.png" })),
      m("div", { class: "login-form-details" },[
        m("h1", "Sign In"),
        m("p.descript","Enter your username and password to sign in"),
        m(
          "form.formdetail",
          m(
            "p",
            m("label", { for: "username" }, "User Name"),
            m("input", {
              name: "username",
              type: "text",
              value: vnode.state["username"],
              oncreate: (vnode2) => {
                (vnode2.dom as HTMLInputElement).focus();
              },
              oninput: (e) => {
                vnode.state["username"] = e.target.value;
              },
            })
          ),
          m(
            "p",
            m("label", { for: "password" }, "Password"),
            m("input", {
              name: "password",
              type: "password",
              value: vnode.state["password"],
              oninput: (e) => {
                vnode.state["password"] = e.target.value;
              },
            })
          ),
          m(
            "p",
            m(
              "button.primary",
              {
                type: "submit",
                onclick: (e) => {
                  e.target.disabled = true;
                  store
                    .logIn(vnode.state["username"], vnode.state["password"])
                    .then(() => {
                      location.reload();
                    })
                    .catch((err) => {
                      notifications.push("error", err.response || err.message);
                      e.target.disabled = false;
                    });
                  return false;
                },
              },
              "SIGN IN"
            )
          )
        ),
        m("div",m(
          "button.primary",
          {
            onclick: () => {
              const cb = (): Children => {
                const attrs = {
                  onPasswordChange: () => {
                    overlay.close(cb);
                    m.redraw();
                  },
                };
                return m(changePasswordComponent, attrs);
              };
              overlay.open(cb);
            },
          },
          "CHANGE PASSWORD"
        )),
      ]));
    },
  };
};
