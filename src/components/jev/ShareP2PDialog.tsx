"use client";

import React, { useState } from "react";
import { IconBroadcast, IconCheck, IconCopy, IconExternal, IconSpark, IconUsers, IconWifi } from "@/brand/icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { buildRoomShareUrl } from "@/lib/jev/room-auth";
import { PeerCursor } from "@/lib/jev/types";

interface ShareP2PDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roomId: string;
  roomSecret: string;
  peers: PeerCursor[];
  webrtcPeers: number;
  broadcastPeers: number;
  demoPeerEnabled: boolean;
  onToggleDemoPeer: (enabled: boolean) => void;
  onCreateManualOffer: () => Promise<string>;
  onAcceptManualOffer: (offerCode: string) => Promise<string>;
  onCompleteManualAnswer: (answerCode: string) => Promise<void>;
}

export function ShareP2PDialog({
  open,
  onOpenChange,
  roomId,
  roomSecret,
  peers,
  webrtcPeers,
  broadcastPeers,
  demoPeerEnabled,
  onToggleDemoPeer,
  onCreateManualOffer,
  onAcceptManualOffer,
  onCompleteManualAnswer,
}: ShareP2PDialogProps) {
  const [copiedLink, setCopiedLink] = useState(false);
  const [offerCode, setOfferCode] = useState("");
  const [remoteOfferInput, setRemoteOfferInput] = useState("");
  const [generatedAnswer, setGeneratedAnswer] = useState("");
  const [remoteAnswerInput, setRemoteAnswerInput] = useState("");
  const [handshakeStatus, setHandshakeStatus] = useState<string | null>(null);
  const [handshakeError, setHandshakeError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const shareUrl =
    typeof window !== "undefined"
      ? buildRoomShareUrl(window.location.origin, roomId, roomSecret)
      : "";

  const copyShareUrl = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 1800);
    } catch {
      // clipboard blocked fallback
    }
  };

  const openSecondPeerTab = () => {
    window.open(shareUrl, "_blank", "noopener,noreferrer");
  };

  const handleGenerateOffer = async () => {
    setBusy(true);
    setHandshakeError(null);
    setHandshakeStatus(null);
    try {
      const code = await onCreateManualOffer();
      setOfferCode(code);
      setHandshakeStatus(
        "Offer ready — copy and send it to your peer, then paste their Answer below."
      );
    } catch (err) {
      setHandshakeError(
        err instanceof Error ? err.message : "Could not create WebRTC offer."
      );
    } finally {
      setBusy(false);
    }
  };

  const handleAcceptOffer = async () => {
    if (!remoteOfferInput.trim()) return;
    setBusy(true);
    setHandshakeError(null);
    setHandshakeStatus(null);
    try {
      const ans = await onAcceptManualOffer(remoteOfferInput);
      setGeneratedAnswer(ans);
      setHandshakeStatus(
        "Answer generated — send it back to the host to open direct P2P DataChannel!"
      );
    } catch (err) {
      setHandshakeError(
        err instanceof Error ? err.message : "Invalid offer code."
      );
    } finally {
      setBusy(false);
    }
  };

  const handleCompleteAnswer = async () => {
    if (!remoteAnswerInput.trim()) return;
    setBusy(true);
    setHandshakeError(null);
    try {
      await onCompleteManualAnswer(remoteAnswerInput);
      setHandshakeStatus("Direct WebRTC DataChannel handshake completed!");
    } catch (err) {
      setHandshakeError(
        err instanceof Error ? err.message : "Invalid answer code."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-[calc(100vw-24px)] overflow-y-auto rounded-2xl border-border bg-card p-4 sm:max-w-lg sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold sm:text-lg">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#0F766E]/15 text-[#0F766E] dark:text-[#34D399]">
              <IconBroadcast className="h-4 w-4" aria-hidden="true" />
            </span>
            Peer-to-Peer Collaboration (WebRTC)
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed text-muted-foreground">
            Skot syncs board state and live cursors peer-to-peer over{" "}
            <span className="font-mono text-foreground">RTCDataChannel</span>{" "}
            with zero database costs. Open a second tab or share the room URL.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="room" className="mt-1">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="room">Room Link & Mesh</TabsTrigger>
            <TabsTrigger value="manual">Zero-Server Handshake</TabsTrigger>
          </TabsList>

          <TabsContent value="room" className="mt-4 space-y-4">
            {/* Room Invite Link */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                  Room ID: {roomId}
                </span>
                <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-[#0F766E] dark:text-[#34D399]">
                  <IconWifi className="h-3 w-3" aria-hidden="true" />
                  {webrtcPeers > 0
                    ? `${webrtcPeers} WebRTC P2P`
                    : broadcastPeers > 0
                      ? `${broadcastPeers} Local Tab Mesh`
                      : "Listening for peers"}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={shareUrl}
                  aria-label="Room share URL"
                  className="min-h-[36px] min-w-0 flex-1 rounded-xl border border-border bg-background/70 px-3 py-2 font-mono text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={copyShareUrl}
                  className="min-h-[36px] shrink-0 gap-1.5 rounded-xl"
                >
                  {copiedLink ? (
                    <>
                      <IconCheck className="h-3.5 w-3.5" aria-hidden="true" />
                      Copied
                    </>
                  ) : (
                    <>
                      <IconCopy className="h-3.5 w-3.5" aria-hidden="true" />
                      Copy
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Try multi-tab right now */}
            <div className="flex flex-col items-start justify-between gap-2.5 rounded-xl border border-border bg-secondary/45 px-3.5 py-3 sm:flex-row sm:items-center">
              <div>
                <p className="text-xs font-semibold text-foreground">
                  Test live P2P sync right now
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Opens this exact room in a second tab with real-time cursor & diagram sync.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={openSecondPeerTab}
                className="min-h-[36px] shrink-0 gap-1.5 rounded-xl"
              >
                Open Peer Tab
                <IconExternal className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </div>

            {/* Solo Demo Peer Toggle */}
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-secondary/35 px-3.5 py-2.5">
              <div className="flex items-center gap-2.5">
                <IconSpark className="h-4 w-4 shrink-0 text-[#C2411D] dark:text-[#FF8562]" aria-hidden="true" />
                <div>
                  <p className="text-xs font-semibold text-foreground">
                    Live Collaborator Preview
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Simulate a remote teammate cursor moving around this canvas.
                  </p>
                </div>
              </div>
              <Switch
                aria-label="Toggle live collaborator preview"
                checked={demoPeerEnabled}
                onCheckedChange={onToggleDemoPeer}
              />
            </div>

            {/* Connected Peers List */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">
                <IconUsers className="h-3.5 w-3.5" aria-hidden="true" />
                Active Peers ({peers.length + 1})
              </div>
              <div className="flex flex-wrap gap-2">
                <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-xs">
                  <span className="h-2 w-2 rounded-full bg-[#0F766E]" aria-hidden="true" />
                  <span className="font-medium">You</span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    host
                  </span>
                </div>
                {peers.map((p) => (
                  <div
                    key={p.peerId}
                    className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-xs"
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: p.color }}
                      aria-hidden="true"
                    />
                    <span className="font-medium">{p.name}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {p.transport}
                      {p.rttMs ? ` · ${p.rttMs}ms` : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="manual" className="mt-4 space-y-3.5">
            <p className="text-xs leading-relaxed text-muted-foreground">
              Connect two browsers on any network with{" "}
              <strong className="text-foreground">zero signaling server</strong>
              . Exchange one compact SDP code over Slack, iMessage, or email.
            </p>

            {/* Step 1: Host */}
            <div className="space-y-2 rounded-xl border border-border bg-secondary/35 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold">1. Host: Create Offer</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={handleGenerateOffer}
                  className="min-h-[36px] rounded-lg text-xs sm:min-h-0 sm:h-7"
                >
                  Generate Offer Code
                </Button>
              </div>
              {offerCode && (
                <textarea
                  readOnly
                  value={offerCode}
                  rows={2}
                  aria-label="Generated WebRTC offer code"
                  onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                  className="w-full rounded-lg border border-border bg-background p-2 font-mono text-[10.5px]"
                />
              )}
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  value={remoteAnswerInput}
                  onChange={(e) => setRemoteAnswerInput(e.target.value)}
                  aria-label="Peer answer code"
                  placeholder="Paste peer's Answer code here…"
                  className="min-h-[36px] min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 font-mono text-[11px] sm:min-h-0"
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={busy || !remoteAnswerInput.trim()}
                  onClick={handleCompleteAnswer}
                  className="min-h-[36px] rounded-lg text-xs sm:h-8 sm:min-h-0"
                >
                  Connect
                </Button>
              </div>
            </div>

            {/* Step 2: Guest */}
            <div className="space-y-2 rounded-xl border border-border bg-secondary/35 p-3">
              <span className="text-xs font-semibold">
                2. Joiner: Paste Host Offer
              </span>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  value={remoteOfferInput}
                  onChange={(e) => setRemoteOfferInput(e.target.value)}
                  aria-label="Host offer code"
                  placeholder="Paste host's Offer code here…"
                  className="min-h-[36px] min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 font-mono text-[11px] sm:min-h-0"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy || !remoteOfferInput.trim()}
                  onClick={handleAcceptOffer}
                  className="min-h-[36px] rounded-lg text-xs sm:h-8 sm:min-h-0"
                >
                  Create Answer
                </Button>
              </div>
              {generatedAnswer && (
                <textarea
                  readOnly
                  value={generatedAnswer}
                  rows={2}
                  aria-label="Generated WebRTC answer code"
                  onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                  className="w-full rounded-lg border border-border bg-background p-2 font-mono text-[10.5px]"
                />
              )}
            </div>

            {handshakeStatus && (
              <p
                role="status"
                aria-live="polite"
                className="rounded-lg bg-[#0F766E]/10 px-3 py-2 text-xs text-[#0F766E] dark:text-[#34D399]"
              >
                {handshakeStatus}
              </p>
            )}
            {handshakeError && (
              <p
                role="alert"
                aria-live="assertive"
                className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                {handshakeError}
              </p>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
