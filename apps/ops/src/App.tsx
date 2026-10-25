import { useEffect, useState } from "react";
import { demoSignIn, getToken, setSession } from "./api";
import { OrdersPage } from "./pages/Orders";
import { OrderDetailPage } from "./pages/OrderDetail";
import { DispatchPage } from "./pages/Dispatch";
import { CatalogPage } from "./pages/Catalog";
import { SupportPage } from "./pages/Support";
import { ProductOperationsApp } from "./pages/ProductOperationsApp";

function route(): string {
  return window.location.hash || "#/orders";
}

export default function App() {
  return import.meta.env.VITE_DEMO_MODE === "true" ? <DemoOperationsApp /> : <ProductOperationsApp />;
}

function DemoOperationsApp() {
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
      <div className="shell">
        <h1>Laundry Ops</h1>
        <p>Restricted console. DEMO sign-in only; production staff access needs SSO and MFA.</p>
        <button onClick={signIn}>Continue with demo operator sign-in</button>
        {error && <p className="err">{error}</p>}
      </div>
    );
  }

  const orderMatch = hash.match(/^#\/orders\/([^/]+)$/);
  return (
    <div className="shell">
      <header>
        <h1>Laundry Ops</h1>
        <nav>
          <a href="#/orders">Orders</a>
          <a href="#/dispatch">Dispatch</a>
          <a href="#/catalog">Catalog</a>
          <a href="#/support">Support</a>
          <button onClick={() => setSession(undefined)}>Sign out</button>
        </nav>
        <label>
          Acting role
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="operator">operator</option>
            <option value="facility">facility</option>
            <option value="admin">admin</option>
          </select>
        </label>
      </header>
      <main>
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
  );
}
