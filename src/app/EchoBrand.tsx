export function EchoMark({ className = "" }: { className?: string }) {
  return <svg aria-hidden="true" className={`echo-mark${className ? ` ${className}` : ""}`} fill="none" viewBox="-1 0 15 20">
    <path d="M0 7a3 3 0 0 1 0 6" />
    <path d="M2 4a6 6 0 0 1 0 12" opacity=".55" />
    <path d="M4 1a9 9 0 0 1 0 18" opacity=".25" />
  </svg>;
}

export function EchoLockup({ className = "" }: { className?: string }) {
  return <span className={`echo-lockup${className ? ` ${className}` : ""}`}><EchoMark /><strong>Echo</strong></span>;
}
