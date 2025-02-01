export default {
  extensions: ["ts"],
  require: ["esm", "ts-node/register/transpile-only"],
  devServer: {
    port: 3010, 
  }
};
