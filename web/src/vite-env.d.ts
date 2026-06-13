/// <reference types="vite/client" />

declare module '*.css' {
  const content: string;
  export default content;
}

interface Window {
  __AGENT_FABRIC_HASH_ROUTER__?: boolean;
}
