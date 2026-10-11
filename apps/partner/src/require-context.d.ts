// Metro/Expo provides require.context at runtime; declare it narrowly so
// standalone tsc passes without pulling broad ambient shims into this package.
interface NodeRequire {
  context: (path: string, deep?: boolean, filter?: RegExp) => any;
}
