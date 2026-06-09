import { NavLink, Outlet } from "react-router-dom";

import { env } from "../../services/env";

export function AppLayout() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="app-kicker">Media Delivery</p>
          <h1>{env.appName}</h1>
        </div>
        <nav aria-label="Primary navigation">
          <NavLink to="/">Media</NavLink>
          <NavLink to="/health">Health</NavLink>
        </nav>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}

