import { useEffect, useState } from "react";
import { demoSignIn, getToken, setSession } from "./api";
import { OrdersPage } from "./pages/Orders";
import { OrderDetailPage } from "./pages/OrderDetail";
import { DispatchPage } from "./pages/Dispatch";
import { CatalogPage } from "./pages/Catalog";
import { SupportPage } from "./pages/Support";

function route(): string {
  return window.location.hash || "#/orders";
}

const NAV = [
  { hash: "#/orders", label: "Orders" },
  { hash: "#/dispatch", label: "Dispatch" },
  { hash: "#/catalog", label: "Catalog" },
  { hash: "#/support", label: "Support" },
];

function titleFor(hash: string): { title: string; sub: string } {
  if (hash.startsWith("#/orders/")) return { title: "Order detail", sub: "Intake, care, and audit trail for one order." };
  if (hash === "#/dispatch") return { title: "Dispatch board", sub: "Assign provisioned riders. No external provider is connected in demo." };
  if (hash === "#/catalog") return { title: "Catalog", sub: "Services, prices, and review moderation." };
  if (hash === "#/support") return { title: "Support", sub: "Incidents, rewash requests, and handoffs." };
  return { title: "Order queue", sub: "Facility-scoped work. Every override needs a reason." };
}

export default function App() {
  const [hash, setHash] = useState(route());
  const [authed, setAuthed] = useState(() => getToken() !== undefined);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState("operator");

  useEffect(() => {
    const onHash = () => setHash(route());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  async function signIn() {
    setError(null);
    try {
      await demoSignIn();
      setAuthed(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed");
    }
  }

  if (!authed) {
    return (
      <div className="ops-shell">
        <aside className="ops-sidebar">
          <div className="ops-brand">
            <div className="ops-brand-mark" aria-hidden="true">L</div>
            <div>
              <h1>Laundry Ops</h1>
              <small>DEMO CONSOLE</small>
            </div>
          </div>
          <p style={{ color: "var(--muted)" }}>Restricted console. DEMO sign-in only; production staff access needs SSO and MFA.</p>
          <button onClick={signIn}>Continue with demo operator sign-in</button>
          {error && <p className="err">{error}</p>}
        </aside>
        <div className="ops-main">
          <div className="ops-content">
            <div className="card">
              <h3>What this console covers</h3>
              <p className="muted">Order queue, intake reconciliation, care workflow, dispatch, refunds, and review moderation. Nothing here touches a live payment or courier.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const orderMatch = hash.match(/^#\/orders\/([^/]+)$/);
  const meta = titleFor(orderMatch ? `#/orders/${orderMatch[1]}` : hash);
  return (
    <div className="ops-shell">
      <aside className="ops-sidebar">
        <div className="ops-brand">
          <div className="ops-brand-mark" aria-hidden="true">L</div>
          <div>
            <h1>Laundry Ops</h1>
            <small>DEMO CONSOLE</small>
          </div>
        </div>
        <nav className="ops-nav" aria-label="Operations sections">
          {NAV.map((n) => {
            const active = orderMatch ? n.hash === "#/orders" : hash === n.hash;
            return (
              <a key={n.hash} href={n.hash} aria-current={active ? "page" : undefined}>
                {n.label}
              </a>
            );
          })}
        </nav>
        <div className="ops-role-card">
          <label style={{ marginTop: 0 }}>
            Acting role
            <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Acting role">
              <option value="operator">operator</option>
              <option value="facility">facility</option>
              <option value="admin">admin</option>
            </select>
          </label>
          <button className="secondary" onClick={() => setSession(undefined)} style={{ width: "100%" }}>Sign out</button>
        </div>
      </aside>
      <div className="ops-main">
        <div className="ops-topbar">
          <div>
            <h2>{meta.title}</h2>
            <p>{meta.sub}</p>
          </div>
          <span className="env-pill">DEMO · {role.toUpperCase()}</span>
        </div>
        <main className="ops-content">
          {orderMatch ? (
            <OrderDetailPage id={orderMatch[1]} />
          ) : hash === "#/dispatch" ? (
            <DispatchPage />
          ) : hash === "#/catalog" ? (
            <CatalogPage />
          ) : hash === "#/support" ? (
            <SupportPage />
          ) : (
            <OrdersPage role={role} facilityId="facility-1" />
          )}
        </main>
      </div>
    </div>
  );
}
