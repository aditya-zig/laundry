// Expo monorepo config for the Laundry customer app.
//
// watchFolders/nodeModulesPaths let Metro follow pnpm workspace symlinks.
// resolveRequest pins @laundry/* to compiled dist output: Metro cannot
// resolve the Node16 ".js"-suffixed relative imports inside packages/*/src,
// while tsc and vitest keep using src through tsconfig paths. Node dist
// compatibility is preserved; no generated JS lives beside src.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

const workspaceDist = {
  "@laundry/contracts": path.resolve(workspaceRoot, "packages/contracts/dist/index.js"),
  "@laundry/api-client": path.resolve(workspaceRoot, "packages/api-client/dist/index.js"),
  "@laundry/design-tokens": path.resolve(workspaceRoot, "packages/design-tokens/dist/index.js"),
};

const defaultResolveRequest = config.resolver.resolveRequest ?? null;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (Object.prototype.hasOwnProperty.call(workspaceDist, moduleName)) {
    return { filePath: workspaceDist[moduleName], type: "sourceFile" };
  }
  if (defaultResolveRequest) return defaultResolveRequest(context, moduleName, platform);
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
