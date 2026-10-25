# Scoped compiled container build

During clean `c8a5249` local container verification the local Docker Desktop
service stopped while receiving dependency installation progress. Docker reported
RPC EOF and was actually inactive; that command failed and produced no success
receipt. No production service or customer database was involved. The exact
cause of the daemon stop has not been established. Its private diagnostic log
was retained and only the local Desktop service was restarted.

The image build previously installed every workspace manifest's dependency tree,
even though it only compiles/deploys API and worker. It now uses pnpm's explicit
`@laundry/api...` and `@laundry/worker...` dependency filters with the frozen
lockfile. The actual Docker build succeeds with this smaller installation; both
production deployments still use the same locked dependency graph, and the
compiled/runtime/context checks must pass on the new clean revision. This is not
a claim that filtering alone diagnoses or fixes the daemon failure.

No global Docker cleanup or unrelated container/image deletion was performed.
Only Laundry verification containers and their private test databases are owned
by these commands. No commercial SMS/model/provider requests were made.
