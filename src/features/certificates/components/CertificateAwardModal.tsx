"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { Award, Download, ExternalLink, Sparkles, X } from "lucide-react";

import { Button } from "@/components/ui/button";

export type AwardedCertificate = {
  id: string;
  course_score_percent: number;
  download_url: string;
};

type ConfettiStyle = CSSProperties & {
  "--confetti-color": string;
  "--confetti-delay": string;
  "--confetti-duration": string;
  "--confetti-drift": string;
  "--confetti-rotation": string;
};

const CONFETTI = Array.from({ length: 28 }, (_, index): ConfettiStyle => ({
  left: `${4 + ((index * 37) % 92)}%`,
  "--confetti-color": ["#1b8755", "#f59e0b", "#2563eb", "#db2777", "#7c3aed"][index % 5],
  "--confetti-delay": `${(index % 7) * 0.08}s`,
  "--confetti-duration": `${1.7 + (index % 5) * 0.16}s`,
  "--confetti-drift": `${((index * 19) % 80) - 40}px`,
  "--confetti-rotation": `${180 + (index % 6) * 90}deg`,
}));

export function CertificateAwardModal({
  open,
  onOpenChange,
  certificate,
  courseTitle,
  certificatesHref,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  certificate: AwardedCertificate | null;
  courseTitle: string;
  certificatesHref: string;
}) {
  if (!certificate) return null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[101] max-h-[92svh] w-[calc(100%_-_2rem)] max-w-4xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-3xl border bg-background shadow-2xl focus:outline-none">
          <style>{`
            @keyframes certificate-confetti-fall {
              0% { opacity: 0; transform: translate3d(0, -24px, 0) rotate(0deg); }
              12% { opacity: 1; }
              100% { opacity: 0; transform: translate3d(var(--confetti-drift), 330px, 0) rotate(var(--confetti-rotation)); }
            }
            @keyframes certificate-firework-burst {
              0% { opacity: 0; transform: scale(.15); }
              20% { opacity: .85; }
              70%, 100% { opacity: 0; transform: scale(1.35); }
            }
            .certificate-confetti-piece {
              animation: certificate-confetti-fall var(--confetti-duration) cubic-bezier(.2,.75,.35,1) var(--confetti-delay) both;
              background: var(--confetti-color);
            }
            .certificate-firework {
              animation: certificate-firework-burst 1.8s ease-out both;
              background: repeating-conic-gradient(from 0deg, #f59e0b 0deg 5deg, transparent 5deg 24deg);
              mask: radial-gradient(circle, transparent 0 30%, #000 32% 58%, transparent 60%);
            }
            @media (prefers-reduced-motion: reduce) {
              .certificate-confetti-piece, .certificate-firework { animation: none; opacity: 0; }
            }
          `}</style>

          <div className="pointer-events-none absolute inset-x-0 top-0 h-80 overflow-hidden" aria-hidden="true">
            {CONFETTI.map((style, index) => (
              <span
                key={index}
                className="certificate-confetti-piece absolute -top-3 h-3 w-2 rounded-sm"
                style={style}
              />
            ))}
            <span className="certificate-firework absolute left-[7%] top-10 size-24" />
            <span className="certificate-firework absolute right-[8%] top-16 size-20 [animation-delay:.3s]" />
          </div>

          <Dialog.Close asChild>
            <button
              type="button"
              className="absolute right-4 top-4 z-10 inline-flex size-10 items-center justify-center rounded-full border bg-background/90 text-muted-foreground shadow-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Close certificate celebration"
            >
              <X className="size-5" />
            </button>
          </Dialog.Close>

          <div className="relative space-y-6 p-5 sm:p-8">
            <div className="mx-auto max-w-2xl space-y-3 text-center">
              <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 shadow-sm">
                <Award className="size-9" aria-hidden="true" />
              </div>
              <div className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-800">
                <Sparkles className="size-4" aria-hidden="true" />
                Course completed
              </div>
              <Dialog.Title className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                Congratulations — you earned a certificate!
              </Dialog.Title>
              <Dialog.Description className="text-sm leading-6 text-muted-foreground sm:text-base">
                You completed <span className="font-semibold text-foreground">{courseTitle}</span> with a course score of{" "}
                <span className="font-semibold text-emerald-700">{certificate.course_score_percent}%</span>.
              </Dialog.Description>
            </div>

            <div className="overflow-hidden rounded-2xl border bg-muted/20 shadow-inner">
              <iframe
                title={`Certificate for ${courseTitle}`}
                src={certificate.download_url}
                className="h-[42vh] min-h-72 w-full bg-white"
              />
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-center">
              <Button variant="outline" asChild className="gap-2">
                <a href={certificate.download_url} target="_blank" rel="noreferrer">
                  <Download className="size-4" />
                  Open certificate
                  <ExternalLink className="size-3.5" />
                </a>
              </Button>
              <Button asChild className="gap-2">
                <Link href={certificatesHref}>
                  <Award className="size-4" />
                  View My Certificates
                </Link>
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
