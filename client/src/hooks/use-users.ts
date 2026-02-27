import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { CreateUserRequest, UpdateUserRequest, UserResponse } from "@shared/schema";

export function useUsers(search?: string) {
  const queryKey = search
    ? ["/api/users", `search=${encodeURIComponent(search)}`]
    : ["/api/users"];

  return useQuery<UserResponse[]>({
    queryKey,
    queryFn: async () => {
      const url = search ? `/api/users?search=${encodeURIComponent(search)}` : "/api/users";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
  });
}

export function useUser(id: string) {
  return useQuery<UserResponse>({
    queryKey: ["/api/users", id],
    enabled: !!id,
  });
}

export function useCreateUser() {
  return useMutation({
    mutationFn: async (data: CreateUserRequest) => {
      const res = await apiRequest("POST", "/api/users", data);
      return res.json() as Promise<UserResponse>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
    },
  });
}

export function useUpdateUser() {
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: UpdateUserRequest }) => {
      const res = await apiRequest("PUT", `/api/users/${id}`, updates);
      return res.json() as Promise<UserResponse>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
    },
  });
}

export function useDeleteUser() {
  return useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/users/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
    },
  });
}
