"use client";

import React from 'react';

// If you were using context providers (e.g., for theme, auth),
// you would wrap children with them here.
// For now, it's a simple pass-through.
export default function Providers({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
