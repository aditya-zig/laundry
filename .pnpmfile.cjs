// Better Auth's optional test-utils peer is not an application runtime
// dependency. Keep workspace Vitest untouched and keep the audit gate intact.
module.exports = {
  hooks: {
    readPackage(pkg) {
      if (pkg.name === 'better-auth' && pkg.version === '1.7.13') {
        if (pkg.peerDependencies) delete pkg.peerDependencies.vitest;
        if (pkg.peerDependenciesMeta) delete pkg.peerDependenciesMeta.vitest;
      }
      return pkg;
    },
  },
};
