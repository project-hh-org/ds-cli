import type { Config } from "tailwindcss";

// 2023.03 브랜드 컬러만 토큰으로 추가함. 나머지는 나중에 정리하기로 했음
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx,js,jsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: "#3B82F6",
      },
    },
  },
  plugins: [],
};

export default config;
