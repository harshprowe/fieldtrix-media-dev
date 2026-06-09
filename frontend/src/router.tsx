import { createBrowserRouter } from "react-router-dom";

import { AppLayout } from "./components/layout/AppLayout";
import { ErrorPage } from "./pages/ErrorPage";
import { HealthPage } from "./pages/HealthPage";
import { MediaPage } from "./pages/MediaPage";
import { NotFoundPage } from "./pages/NotFoundPage";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppLayout />,
    errorElement: <ErrorPage />,
    children: [
      {
        index: true,
        element: <MediaPage />
      },
      {
        path: "health",
        element: <HealthPage />
      },
      {
        path: "*",
        element: <NotFoundPage />
      }
    ]
  }
]);

