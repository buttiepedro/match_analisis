import { create } from "zustand";
import { persist } from "zustand/middleware";
import api from "../lib/axios";

interface User {
  id: string;
  email: string;
  full_name: string;
  role: "superadmin" | "club_admin" | "analyst";
  club_id: string | null;
}

interface AuthState {
  user: User | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      login: async (email, password) => {
        const { data } = await api.post("/auth/login", { email, password });
        localStorage.setItem("access_token", data.access_token);
        set({ token: data.access_token, user: data.user });
      },
      logout: () => {
        localStorage.removeItem("access_token");
        set({ user: null, token: null });
      },
    }),
    { name: "auth-storage" }
  )
);
