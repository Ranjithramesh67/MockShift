'use client';

import React from 'react';

interface IconProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

function svgProps({ size = 16, className, style }: IconProps, filled = false) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: filled ? 'currentColor' : 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    style,
    'aria-hidden': true,
  };
}

export const WorkspaceIcon = (p: IconProps) => (
  <svg {...svgProps(p, true)} fill="none">
    <rect x="3" y="3" width="7" height="7" rx="1.5" fill="currentColor" stroke="none" opacity="0.55" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" fill="currentColor" stroke="none" opacity="0.85" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" fill="currentColor" stroke="none" opacity="0.85" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" fill="currentColor" stroke="none" opacity="0.35" />
  </svg>
);

export const TeamIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M16 4.5a3.5 3.5 0 0 1 0 7" />
    <path d="M17.5 13.5a6 6 0 0 1 4 6.5" />
  </svg>
);

export const CollectionIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
);

export const MoveIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <path d="M4 12h13" />
    <path d="m13 8 4 4-4 4" />
    <path d="M4 7h5M4 17h5" />
  </svg>
);

export const RequestIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <path d="M9 18V6l10 6-10 6z" fill="currentColor" fillOpacity="0.15" />
  </svg>
);

export const KeyIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <circle cx="8" cy="15" r="4.5" />
    <path d="M11.5 11.5 21 2" />
    <path d="M17 6l3 3" />
    <path d="M14 9l2 2" />
  </svg>
);

export const ChevronIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <path d="m9 6 6 6-6 6" />
  </svg>
);

export const PlusIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const TrashIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <path d="M3 6h18" />
    <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);

export const SendIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <path d="M22 2 11 13" />
    <path d="M22 2 15 22l-4-9-9-4 20-7z" />
  </svg>
);

export const SaveIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    <path d="M17 21v-8H7v8" />
    <path d="M7 3v5h8" />
  </svg>
);

export const ImportIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <path d="M12 3v12" />
    <path d="m7 10 5 5 5-5" />
    <path d="M4 21h16" />
  </svg>
);

export const ExportIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <path d="M12 15V3" />
    <path d="m7 8 5-5 5 5" />
    <path d="M4 21h16" />
  </svg>
);

export const FileIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" />
    <path d="M14 2v6h6" />
  </svg>
);

export const CopyIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

export const ShareIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <path d="M8.6 13.5l6.8 4M8.6 10.5l6.8-4" />
  </svg>
);

export const LayoutIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M12 3v18" />
  </svg>
);

export const SplitIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 12h18" />
  </svg>
);

export const RequestPaneIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18" />
    <path d="M3 15h18" />
  </svg>
);

export const ResponsePaneIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18" />
    <path d="M3 15h7" />
    <circle cx="15" cy="15" r="2" fill="currentColor" />
  </svg>
);

export const WorkflowIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <circle cx="6" cy="6" r="3" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="12" cy="18" r="3" />
    <path d="M9 6h6M7 8.5l3.5 7M17 8.5l-3.5 7" />
  </svg>
);

export const BoltIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
  </svg>
);

export const ShieldIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <path d="M12 22s8-3 8-10V5l-8-3-8 3v7c0 7 8 10 8 10z" />
  </svg>
);

export const UserIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </svg>
);

export const LogoutIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5" />
    <path d="M21 12H9" />
  </svg>
);

export const CheckIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export const AlertIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5" />
    <path d="M12 16.5h.01" />
  </svg>
);

export const InfoIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 16v-5" />
    <path d="M12 8h.01" />
  </svg>
);

export const XIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

export const MenuIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);

export const ArrowUpIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <path d="M12 19V5" />
    <path d="m5 12 7-7 7 7" />
  </svg>
);

export const ArrowDownIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <path d="M12 5v14" />
    <path d="m19 12-7 7-7-7" />
  </svg>
);

export const GripIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <circle cx="9" cy="6" r="1" fill="currentColor" />
    <circle cx="15" cy="6" r="1" fill="currentColor" />
    <circle cx="9" cy="12" r="1" fill="currentColor" />
    <circle cx="15" cy="12" r="1" fill="currentColor" />
    <circle cx="9" cy="18" r="1" fill="currentColor" />
    <circle cx="15" cy="18" r="1" fill="currentColor" />
  </svg>
);

export const GlobeIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z" />
  </svg>
);

export const LockIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

export const RestIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <path d="M4 8h16M4 12h10M4 16h13" />
  </svg>
);

export const SoapIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <path d="M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
    <path d="M9 3v18" />
    <path d="M12 8h4M12 12h4M12 16h3" />
  </svg>
);

export const GraphqlIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <path d="M12 2v20" />
    <path d="M5.5 7 18.5 17" />
    <path d="M18.5 7 5.5 17" />
    <path d="M4 8l8 4.5L20 8" />
    <path d="M4 16l8 4.5L20 16" />
  </svg>
);

export const RowsIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 10h18" />
    <path d="M3 16h18" />
  </svg>
);

export const ListIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <path d="M8 6h13M8 12h13M8 18h13" />
    <circle cx="4" cy="6" r="1" fill="currentColor" />
    <circle cx="4" cy="12" r="1" fill="currentColor" />
    <circle cx="4" cy="18" r="1" fill="currentColor" />
  </svg>
);

export const CodeIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <path d="m8 6-6 6 6 6" />
    <path d="m16 6 6 6-6 6" />
  </svg>
);

export const FormulaIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <path d="M4 6c2 0 2-1.5 4-1.5S10 6 12 6s2 1.5 4 1.5 2-1.5 4-1.5" />
    <path d="M4 18c2 0 2 1.5 4 1.5s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5" />
    <path d="M12 5v7c2 2 0 4-2 5.5M14 9h4" />
  </svg>
);

export const PlayIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <path d="m7 4 13 8-13 8V4z" fill="currentColor" fillOpacity="0.2" />
  </svg>
);

export const BellIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <path d="M6 9a6 6 0 1 1 12 0v4l2 3H4l2-3V9z" />
    <path d="M10 20a2 2 0 0 0 4 0" />
  </svg>
);

export const ClockIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

export const PlugIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0V8z" />
    <path d="M12 17v5" />
  </svg>
);

export const UsersIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <circle cx="9" cy="8" r="3" />
    <path d="M3 20c0-3 3-5 6-5s6 2 6 5" />
    <path d="M16 5a3 3 0 0 1 0 6M18 15c2 .7 3 2.3 3 4" />
  </svg>
);

export const HistoryIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <path d="M3 12a9 9 0 1 0 3-6.7" />
    <path d="M3 4v5h5" />
    <path d="M12 7v5l3 2" />
  </svg>
);

export const LayersIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <path d="m12 3 9 5-9 5-9-5 9-5z" />
    <path d="m3 13 9 5 9-5" />
  </svg>
);

export const ServerIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <rect x="3" y="4" width="18" height="7" rx="2" />
    <rect x="3" y="13" width="18" height="7" rx="2" />
    <path d="M7 7.5h.01M7 16.5h.01" />
  </svg>
);

export const ZoomIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);

export const FolderIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);

export const PencilIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    <path d="m15 5 4 4" />
  </svg>
);

export const DotsIcon = (p: IconProps) => (
  <svg {...svgProps(p)}>
    <circle cx="12" cy="5" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="12" cy="19" r="1.6" fill="currentColor" stroke="none" />
  </svg>
);
