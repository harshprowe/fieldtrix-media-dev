import { env } from "../services/env";
import { getAccessToken } from "../storage/authTokenStorage";

export type FieldTrixApiConfig = {
  apiBaseUrl: string;
  getAccessToken: () => string | null;
  fetcher: typeof fetch;
};

let apiConfig: FieldTrixApiConfig = {
  apiBaseUrl: env.apiBaseUrl,
  getAccessToken,
  fetcher: fetch.bind(globalThis)
};

export function configureFieldTrixApi(config: Partial<FieldTrixApiConfig>): void {
  apiConfig = {
    ...apiConfig,
    ...config,
    apiBaseUrl: config.apiBaseUrl?.replace(/\/$/, "") ?? apiConfig.apiBaseUrl
  };
}

export function getFieldTrixApiConfig(): FieldTrixApiConfig {
  return apiConfig;
}
