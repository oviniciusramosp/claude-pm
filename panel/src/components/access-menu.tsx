// panel/src/components/access-menu.tsx

import React, { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Copy01, Check, Globe01, Wifi } from '@untitledui/icons';
import { Icon } from './icon';
import { cx } from '@/utils/cx';

interface ServerInfo {
  localUrl: string;
  lanUrl: string | null;
  tunnelUrl: string | null;
  tunnelStatus: 'inactive' | 'starting' | 'active' | 'error';
  tunnelError: string | null;
}

export function AccessMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);

  // Fetch server info when menu opens
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch('/api/server/info')
      .then((r) => r.json())
      .then((data: ServerInfo) => {
        setInfo(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [open]);

  // Generate QR code when info changes
  useEffect(() => {
    if (!info) {
      setQrDataUrl(null);
      return;
    }
    const url = info.tunnelUrl || info.lanUrl;
    if (!url) {
      setQrDataUrl(null);
      return;
    }
    QRCode.toDataURL(url, {
      width: 200,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' }
    }).then(setQrDataUrl).catch(() => setQrDataUrl(null));
  }, [info]);

  // Click outside to close
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open, onClose]);

  const accessUrl = info?.tunnelUrl || info?.lanUrl;

  const copyUrl = useCallback(async () => {
    if (!accessUrl) return;
    try {
      await navigator.clipboard.writeText(accessUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  }, [accessUrl]);

  if (!open) return null;

  const isTunnel = Boolean(info?.tunnelUrl);
  const isTunnelStarting = info?.tunnelStatus === 'starting';
  const isTunnelError = info?.tunnelStatus === 'error';

  return (
    <div
      ref={ref}
      className="absolute left-3 right-3 top-full z-50 mt-1 overflow-hidden rounded-lg border border-secondary bg-primary shadow-lg"
    >
      <div className="p-4">
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <div className="size-5 animate-spin rounded-full border-2 border-secondary border-t-brand-primary" />
          </div>
        ) : !info ? (
          <p className="text-center text-sm text-tertiary">Failed to load server info</p>
        ) : (
          <>
            {/* Status label */}
            <div className="mb-3 flex items-center gap-2">
              <Icon icon={isTunnel ? Globe01 : Wifi} className="size-4 text-brand-primary" />
              <span className="text-xs font-semibold uppercase tracking-wider text-quaternary">
                {isTunnel ? 'Public Access' : 'Local Network'}
              </span>
            </div>

            {/* QR Code */}
            {qrDataUrl ? (
              <div className="flex justify-center rounded-lg bg-white p-2">
                <img src={qrDataUrl} alt="QR Code" className="size-[180px]" />
              </div>
            ) : isTunnelStarting ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-lg bg-secondary py-8">
                <div className="size-5 animate-spin rounded-full border-2 border-secondary border-t-brand-primary" />
                <span className="text-xs text-tertiary">Starting tunnel...</span>
              </div>
            ) : isTunnelError ? (
              <div className="rounded-lg bg-error-secondary p-3">
                <p className="text-center text-xs text-error-primary">{info.tunnelError}</p>
              </div>
            ) : !info.lanUrl ? (
              <div className="rounded-lg bg-secondary p-3">
                <p className="text-center text-xs text-tertiary">No network interface found</p>
              </div>
            ) : null}

            {/* URL + Copy */}
            {accessUrl ? (
              <button
                type="button"
                onClick={copyUrl}
                className={cx(
                  'mt-3 flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left transition',
                  'border-secondary bg-secondary hover:bg-primary_hover'
                )}
              >
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-secondary">
                  {accessUrl}
                </span>
                <Icon
                  icon={copied ? Check : Copy01}
                  className={cx('size-4 shrink-0', copied ? 'text-success-primary' : 'text-quaternary')}
                />
              </button>
            ) : null}

            {/* Hint */}
            <p className="mt-2 text-center text-[11px] text-quaternary">
              {isTunnel
                ? 'Scan to access from anywhere'
                : 'Scan to access from the same network'}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
