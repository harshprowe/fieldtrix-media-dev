import type { ReactNode } from "react";

import { FieldTrixMediaProvider } from "./fieldtrix";
import { queryClient } from "./services/queryClient";

type AppProvidersProps = {
  children: ReactNode;
};

export function AppProviders({ children }: AppProvidersProps) {
  return <FieldTrixMediaProvider queryClient={queryClient}>{children}</FieldTrixMediaProvider>;
}
