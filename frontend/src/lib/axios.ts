import axios from "axios";

const rawApiUrl = import.meta.env.VITE_API_URL || "";
const baseURL =
  rawApiUrl && !rawApiUrl.startsWith("http") ? `https://${rawApiUrl}` : rawApiUrl;

const api = axios.create({ baseURL });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("access_token");
      window.location.href = "/login";
    }
    return Promise.reject(error);
  }
);

export default api;
