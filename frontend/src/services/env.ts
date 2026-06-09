type RuntimeEnv = {
  appName: string;
  apiBaseUrl: string;
  enablePwa: boolean;
};

type EnvStringKey = "VITE_APP_NAME" | "VITE_API_BASE_URL" | "VITE_ENABLE_PWA";

function readRequiredEnv(name: EnvStringKey, fallback?: string): string {
  const value = import.meta.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function readBooleanEnv(name: EnvStringKey, fallback: boolean): boolean {
  const value = import.meta.env[name];
  if (value === undefined) {
    return fallback;
  }
  return value.toLowerCase() === "true";
}

export const env: RuntimeEnv = {
  appName: readRequiredEnv("VITE_APP_NAME", "FieldTrix"),
  apiBaseUrl: readRequiredEnv("VITE_API_BASE_URL", "http://localhost:8000/api/v1").replace(
    /\/$/,
    ""
  ),
  enablePwa: readBooleanEnv("VITE_ENABLE_PWA", true)
};
