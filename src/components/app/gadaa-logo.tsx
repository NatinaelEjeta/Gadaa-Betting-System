export function GadaaLogo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path
        d="M24 3L42 9v13c0 11.5-7.6 19.9-18 23C13.6 41.9 6 33.5 6 22V9l18-6z"
        fill="var(--primary)"
      />
      <path
        d="M24 6.2L39 11v11c0 9.8-6.4 17-15 19.7C15.4 39 9 31.8 9 22V11l15-4.8z"
        fill="none"
        stroke="var(--gold)"
        strokeWidth="1.6"
      />
      <text
        x="24"
        y="29"
        textAnchor="middle"
        fontSize="17"
        fontWeight="800"
        fill="var(--gold)"
        fontFamily="var(--font-geist-sans), sans-serif"
      >
        G
      </text>
    </svg>
  );
}
