import { useQuery } from "@tanstack/react-query";

import { listMedia } from "../api/media";

export function useMediaList(params: { limit?: number; offset?: number } = {}) {
  return useQuery({
    queryKey: ["media", params],
    queryFn: () => listMedia(params)
  });
}

