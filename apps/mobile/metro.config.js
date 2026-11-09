// Metro config for the pnpm monorepo: watch workspace packages and let TS-style ".js" imports
// inside them resolve to their ".ts" sources.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);
const workspaceRoot = path.resolve(__dirname, '../..');
config.watchFolders = [...(config.watchFolders ?? []), workspaceRoot];

const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstream ?? context.resolveRequest;
  if (
    moduleName.startsWith('.') &&
    moduleName.endsWith('.js') &&
    context.originModulePath.includes(`${path.sep}packages${path.sep}`)
  ) {
    try {
      return resolve(context, moduleName.replace(/\.js$/, '.ts'), platform);
    } catch {
      /* fall through */
    }
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
