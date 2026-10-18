import React from "react";

interface RiyalIconProps {
  className?: string;
  size?: string | number;
}

/**
 * Saudi Riyal currency label.
 *
 * The platform standard is the ISO text code — never a localized glyph — so
 * every figure reads "17,143,076 SAR". This component keeps its historical
 * name/import path but now renders the plain "SAR" code.
 */
const RiyalIcon: React.FC<RiyalIconProps> = ({ className = "", size }) => (
  <span
    role="img"
    aria-label="SAR"
    className={className}
    style={size ? { fontSize: size } : undefined}
  >
    SAR
  </span>
);

export default RiyalIcon;
