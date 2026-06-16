import { ErrorState } from "../components/feedback/ErrorState";
import { LoadingState } from "../components/feedback/LoadingState";
import { useHealth } from "../hooks/useHealth";

export function HealthPage() {
  const healthQuery = useHealth();

  if (healthQuery.isLoading) {
    return <LoadingState label="Checking API health" />;
  }

  if (healthQuery.isError) {
    return <ErrorState message={healthQuery.error.message} />;
  }

  if (!healthQuery.data) {
    return <ErrorState message="Health response was empty." />;
  }

  return (
    <section className="page-section">
      <div className="page-heading">
        <h2>System Health</h2>
        <p>API status: {healthQuery.data.status}</p>
      </div>
      <dl className="health-list">
        <div>
          <dt>Database</dt>
          <dd>{healthQuery.data.database}</dd>
        </div>
      </dl>
    </section>
  );
}
