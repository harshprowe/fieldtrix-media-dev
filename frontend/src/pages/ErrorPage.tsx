import { useRouteError } from "react-router-dom";

import { ErrorState } from "../components/feedback/ErrorState";

export function ErrorPage() {
  const error = useRouteError();
  const message = error instanceof Error ? error.message : "The requested view could not load.";

  return <ErrorState title="Route error" message={message} />;
}

