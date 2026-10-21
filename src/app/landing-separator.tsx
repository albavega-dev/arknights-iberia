"use client";

import { useEffect, useRef } from "react";
import { ShipWheel } from "lucide-react";

export function LandingSeparator() {
  const separatorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const separator = separatorRef.current;

    if (!separator) {
      return;
    }

    separator.classList.add("is-observed");

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      separator.classList.add("is-visible");
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) {
          return;
        }

        separator.classList.add("is-visible");
        observer.disconnect();
      },
      { threshold: 0.2 },
    );

    observer.observe(separator);

    return () => observer.disconnect();
  }, []);

  return (
    <div ref={separatorRef} className="landing-separator" aria-hidden="true">
      <span className="landing-separator-line" />
      <ShipWheel className="landing-separator-wheel" size={18} strokeWidth={1.6} />
      <span className="landing-separator-line" />
    </div>
  );
}
