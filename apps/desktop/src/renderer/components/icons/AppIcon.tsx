interface Props {
  size?:      number | undefined;
  className?: string | undefined;
}

export default function AppIcon({ size = 20, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 280.33 249.5"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M277.34,114.08L219.19,12.12c-4.03-7.07-11.53-11.45-19.67-11.5L82.13,0c-8.14-.04-15.69,4.26-19.79,11.29L3.11,112.63c-4.11,7.03-4.15,15.71-.12,22.79l58.15,101.96c4.03,7.07,11.53,11.45,19.67,11.5l117.38.62c8.14.04,15.69-4.26,19.79-11.29l59.23-101.34c4.11-7.03,4.15-15.71.12-22.79ZM251.27,129.14l-36.8,62.98c-3.79,6.49-13.17,6.46-16.93-.05l-44.98-78c-1.73-3-4.92-4.86-8.38-4.9l-90.04-.9c-7.51-.08-12.14-8.24-8.35-14.72l36.8-62.98c1.76-3.02,5-4.87,8.5-4.85l101.49.54c3.5.02,6.72,1.9,8.45,4.94l50.28,88.16c1.73,3.04,1.71,6.77-.05,9.79Z" />
    </svg>
  );
}
