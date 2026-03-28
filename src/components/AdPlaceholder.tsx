"use client";
import React, { useEffect } from 'react';

declare global {
  interface Window {
    adsbygoogle: any[];
  }
}

const AdPlaceholder: React.FC<{ adSlot?: string; isResponsive?: boolean; adFormat?: string; customStyle?: React.CSSProperties }> = ({ 
  adSlot, 
  isResponsive = true,
  adFormat = "auto",
  customStyle,
 }) => {
  useEffect(() => {
    if (typeof window !== "undefined" && window.adsbygoogle) {
      try {
        window.adsbygoogle.push({});
      } catch (e) {
        console.error("AdSense error: ", e);
      }
    }
  }, [adSlot]); 

  const adClientId = process.env.NEXT_PUBLIC_ADMOB_CLIENT_ID; 

  if (!adClientId) {
    return (
      <div className="w-full h-16 bg-muted flex items-center justify-center my-4 rounded-md shadow">
        <p className="text-muted-foreground text-sm">Ad Placeholder (Ad Client ID not configured)</p>
      </div>
    );
  }
  
  const currentAdSlot = adSlot || "YOUR_DEFAULT_AD_SLOT_ID_REPLACE_ME"; 

  const defaultStyle: React.CSSProperties = {
    display: 'block',
    width: isResponsive ? '100%' : '320px', 
    height: isResponsive ? 'auto' : '50px', 
    minHeight: '50px', 
    textAlign: 'center',
    ...customStyle, 
  };

  return (
    <div className="w-full flex items-center justify-center my-4" aria-label="Advertisement">
      <ins
        className="adsbygoogle"
        style={defaultStyle}
        data-ad-client={adClientId}
        data-ad-slot={currentAdSlot} 
        data-ad-format={adFormat} 
        data-full-width-responsive={isResponsive.toString()}
        data-testid="ad-placeholder-ins"
      ></ins>
    </div>
  );
};

export default AdPlaceholder;
