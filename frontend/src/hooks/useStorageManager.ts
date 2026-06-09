import { useCallback, useEffect, useState } from "react";

import {
  storageManagerService,
  type StorageBudgetStatus
} from "../services/storage";

export type UseStorageManagerState = {
  status: StorageBudgetStatus | null;
  isLoading: boolean;
  error: Error | null;
};

export function useStorageManager() {
  const [state, setState] = useState<UseStorageManagerState>({
    status: null,
    isLoading: true,
    error: null
  });

  const refresh = useCallback(async () => {
    setState((current) => ({ ...current, isLoading: true, error: null }));
    try {
      const status = await storageManagerService.getStatus();
      setState({ status, isLoading: false, error: null });
      return status;
    } catch (error) {
      const nextError = error instanceof Error ? error : new Error("Unable to read storage usage");
      setState((current) => ({ ...current, isLoading: false, error: nextError }));
      throw nextError;
    }
  }, []);

  const requestPersistentStorage = useCallback(async () => {
    await storageManagerService.requestPersistentStorage();
    return refresh();
  }, [refresh]);

  useEffect(() => {
    void requestPersistentStorage();
  }, [requestPersistentStorage]);

  return {
    ...state,
    refresh,
    requestPersistentStorage
  };
}
