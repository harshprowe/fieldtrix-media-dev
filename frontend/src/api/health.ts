import { apiRequest } from "./client";

export type HealthResponse = {
  status: string;
  database: string;
};

export function getHealth() {
  return apiRequest<HealthResponse>("/health", { auth: false });
}

