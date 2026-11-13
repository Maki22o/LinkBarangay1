// LinkBarangay — inline SVG icon set (moved unchanged from the original App.tsx)

export type IconName =
  | "home" | "plus" | "file" | "bell" | "user" | "search" | "arrow" | "check" | "clock"
  | "pin" | "upload" | "chevron" | "menu" | "logout" | "shield" | "route" | "briefcase"
  | "users" | "settings" | "chart" | "history" | "alert" | "close" | "eye" | "filter"
  | "phone" | "help"

const paths: Record<IconName, string[]> = {
  home: ["M3 10.5 12 3l9 7.5", "M5 9.5V21h14V9.5", "M9 21v-7h6v7"],
  plus: ["M12 5v14", "M5 12h14"],
  file: ["M6 3h8l4 4v14H6z", "M14 3v5h5", "M9 13h6", "M9 17h6"],
  bell: ["M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9", "M10 21h4"],
  user: ["M20 21a8 8 0 0 0-16 0", "M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10"],
  search: ["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16", "m21 21-4.35-4.35"],
  arrow: ["M5 12h14", "m13 6 6 6-6 6"],
  check: ["m5 12 4 4L19 6"],
  clock: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20", "M12 6v6l4 2"],
  pin: [
    "M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0",
    "M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6",
  ],
  upload: ["M12 16V4", "m7 9 5-5 5 5", "M5 20h14"],
  chevron: ["m9 18 6-6-6-6"],
  menu: ["M4 6h16", "M4 12h16", "M4 18h16"],
  logout: ["M10 17l5-5-5-5", "M15 12H3", "M15 3h6v18h-6"],
  shield: ["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10", "m9 12 2 2 4-4"],
  route: [
    "M6 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6",
    "M18 7a3 3 0 1 0 0-6 3 3 0 0 0 0 6",
    "M6 16V8a4 4 0 0 1 4-4h5",
    "m12 7 3 3 3-3",
  ],
  briefcase: ["M4 7h16v13H4z", "M9 7V4h6v3", "M4 12h16", "M10 12v2h4v-2"],
  users: [
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",
    "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8",
    "M22 21v-2a4 4 0 0 0-3-3.87",
    "M16 3.13a4 4 0 0 1 0 7.75",
  ],
  settings: [
    "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7",
    "M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.57V21h-4v-.08a1.7 1.7 0 0 0-1.03-1.57 1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15 1.7 1.7 0 0 0 3.04 14H3v-4h.08A1.7 1.7 0 0 0 4.65 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3.04V3h4v.08A1.7 1.7 0 0 0 15 4.65a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9 1.7 1.7 0 0 0 20.96 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15",
  ],
  chart: ["M4 20V10", "M10 20V4", "M16 20v-7", "M22 20H2"],
  history: ["M3 12a9 9 0 1 0 3-6.7L3 8", "M3 3v5h5", "M12 7v5l3 2"],
  alert: [
    "M12 9v4",
    "M12 17h.01",
    "M10.3 3.5 2 19h20L13.7 3.5a2 2 0 0 0-3.4 0",
  ],
  close: ["M6 6l12 12", "M18 6 6 18"],
  eye: [
    "M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12",
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6",
  ],
  filter: ["M4 5h16l-6 7v6l-4 2v-8z"],
  phone: [
    "M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.78.62 2.63a2 2 0 0 1-.45 2.11L8 9.74a16 16 0 0 0 6 6l1.28-1.28a2 2 0 0 1 2.11-.45c.85.29 1.73.5 2.63.62A2 2 0 0 1 22 16.92",
  ],
  help: [
    "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20",
    "M9.5 9a2.5 2.5 0 1 1 4 2c-1.5 1-1.5 2-1.5 3",
    "M12 18h.01",
  ],
}

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name].map((path, index) => (
        <path d={path} key={index} />
      ))}
    </svg>
  )
}
