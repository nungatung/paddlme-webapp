import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";
import type { User } from "firebase/auth";
import type {
  DocumentData,
  QueryDocumentSnapshot,
  Unsubscribe,
} from "firebase/firestore";

type ConversationSnapshot = QueryDocumentSnapshot<DocumentData>;
type MessageSnapshot = QueryDocumentSnapshot<DocumentData>;
type View = "loading" | "signed-out" | "inbox";
type ScrollMode = "bottom" | "preserve" | null;

function asDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof value.toDate === "function"
  ) {
    return value.toDate();
  }
  return null;
}

function formatListTimestamp(value: unknown): string {
  const date = asDate(value);
  if (!date) return "";
  const elapsed = Math.max(0, Date.now() - date.getTime());
  if (elapsed < 60_000) return "Now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h`;
  if (elapsed < 172_800_000) return "Yesterday";
  if (elapsed < 7 * 86_400_000) return `${Math.floor(elapsed / 86_400_000)}d`;
  return new Intl.DateTimeFormat("en-NZ", {
    day: "numeric",
    month: "short",
  }).format(date);
}

function formatDay(date: Date): string {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(date, today)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";
  return new Intl.DateTimeFormat("en-NZ", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("en-NZ", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function otherParticipantId(
  conversation: Record<string, any>,
  currentUserId: string,
): string {
  const participantIds = Array.isArray(conversation.participantIds)
    ? conversation.participantIds
    : [];
  return participantIds.find((id: string) => id !== currentUserId) || "";
}

function Avatar({
  imageUrl,
  name,
  size = "h-12 w-12",
}: {
  imageUrl: unknown;
  name: string;
  size?: string;
}) {
  const initial = name.trim().charAt(0).toUpperCase() || "P";
  return typeof imageUrl === "string" && imageUrl ? (
    <img
      src={imageUrl}
      alt={name}
      className={`${size} shrink-0 rounded-full bg-ocean-50 object-cover`}
    />
  ) : (
    <span
      className={`${size} grid shrink-0 place-items-center rounded-full bg-ocean-50 text-sm font-extrabold text-ocean-700`}
      aria-label={name}
    >
      {initial}
    </span>
  );
}

function ChatIcon({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 11.5a8.4 8.4 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.4 8.4 0 01-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 01-.9-3.8A8.5 8.5 0 018.7 3.9a8.4 8.4 0 013.8-.9h.5a8.5 8.5 0 018 8z" />
    </svg>
  );
}

export default function MessagesApp() {
  const [view, setView] = useState<View>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [conversations, setConversations] = useState<ConversationSnapshot[]>([]);
  const [activeConversation, setActiveConversation] =
    useState<ConversationSnapshot | null>(null);
  const [messages, setMessages] = useState<MessageSnapshot[]>([]);
  const [olderMessages, setOlderMessages] = useState<MessageSnapshot[]>([]);
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sending, setSending] = useState(false);
  const [pageError, setPageError] = useState("");
  const [threadError, setThreadError] = useState("");
  const [mobileView, setMobileView] = useState<"list" | "thread">("list");
  const [draft, setDraft] = useState("");

  const timelineRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const conversationRef = useRef<ConversationSnapshot | null>(null);
  const conversationsRef = useRef<ConversationSnapshot[]>([]);
  const userRef = useRef<User | null>(null);
  const messageUnsubscribeRef = useRef<Unsubscribe | null>(null);
  const conversationUnsubscribeRef = useRef<Unsubscribe | null>(null);
  const authUnsubscribeRef = useRef<Unsubscribe | null>(null);
  const conversationGenerationRef = useRef(0);
  const scrollModeRef = useRef<ScrollMode>(null);
  const lastTimelineHeightRef = useRef(0);
  const markingReadRef = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    let unsubscribeAuth: Unsubscribe | undefined;

    void (async () => {
      try {
        const [{ auth, db }, firestore, authModule] = await Promise.all([
          import("../../lib/firebase"),
          import("firebase/firestore"),
          import("firebase/auth"),
        ]);
        if (cancelled) return;

        unsubscribeAuth = authModule.onAuthStateChanged(auth, (nextUser) => {
          conversationUnsubscribeRef.current?.();
          conversationUnsubscribeRef.current = null;
          messageUnsubscribeRef.current?.();
          messageUnsubscribeRef.current = null;
          conversationGenerationRef.current += 1;
          userRef.current = nextUser;
          setUser(nextUser);
          setActiveConversation(null);
          conversationRef.current = null;
          setConversations([]);
          conversationsRef.current = [];
          setMessages([]);
          setOlderMessages([]);
          setPageError("");
          setThreadError("");
          setMobileView("list");

          if (!nextUser) {
            setView("signed-out");
            return;
          }

          setView("inbox");
          conversationUnsubscribeRef.current = firestore.onSnapshot(
            firestore.query(
              firestore.collection(db, "conversations"),
              firestore.where(
                "participantIds",
                "array-contains",
                nextUser.uid,
              ),
              firestore.orderBy("updatedAt", "desc"),
            ),
            (snapshot) => {
              const nextConversations = snapshot.docs;
              conversationsRef.current = nextConversations;
              setConversations(nextConversations);

              const activeId = conversationRef.current?.id;
              if (activeId) {
                const updated = nextConversations.find(
                  (conversation) => conversation.id === activeId,
                );
                if (updated) {
                  conversationRef.current = updated;
                  setActiveConversation(updated);
                }
              }

              const requestedId = new URL(window.location.href).searchParams.get(
                "conversation",
              );
              if (requestedId && requestedId !== activeId) {
                const requested = nextConversations.find(
                  (conversation) => conversation.id === requestedId,
                );
                if (requested) openConversation(requested, false);
              }
            },
            (error) => {
              console.error("Failed to load conversations:", error);
              setPageError(
                "We couldn't load your messages. Refresh the page to try again.",
              );
            },
          );
        });
        authUnsubscribeRef.current = unsubscribeAuth;
      } catch (error) {
        console.error("Failed to initialize messaging:", error);
        if (!cancelled) {
          setPageError(
            "We couldn't connect to messaging. Refresh the page to try again.",
          );
          setView("signed-out");
        }
      }
    })();

    return () => {
      cancelled = true;
      unsubscribeAuth?.();
      authUnsubscribeRef.current?.();
      authUnsubscribeRef.current = null;
      conversationUnsubscribeRef.current?.();
      conversationUnsubscribeRef.current = null;
      messageUnsubscribeRef.current?.();
      messageUnsubscribeRef.current = null;
    };
  }, []);

  const updateUrl = useCallback((conversationId: string | null) => {
    const url = new URL(window.location.href);
    if (conversationId) url.searchParams.set("conversation", conversationId);
    else url.searchParams.delete("conversation");
    window.history.pushState({}, "", url);
  }, []);

  const markConversationRead = useCallback(
    async (conversationId: string, currentUser: User) => {
      if (markingReadRef.current.has(conversationId)) return;
      markingReadRef.current.add(conversationId);
      try {
        const firestore = await import("firebase/firestore");
        const { db } = await import("../../lib/firebase");
        await firestore.updateDoc(
          firestore.doc(db, "conversations", conversationId),
          { [`unreadCounts.${currentUser.uid}`]: 0 },
        );
        const unread = await firestore.getDocs(
          firestore.query(
            firestore.collection(
              db,
              "conversations",
              conversationId,
              "messages",
            ),
            firestore.where("receiverId", "==", currentUser.uid),
            firestore.where("isRead", "==", false),
            firestore.limit(200),
          ),
        );
        if (!unread.empty) {
          const batch = firestore.writeBatch(db);
          unread.docs.forEach((message) =>
            batch.update(message.ref, { isRead: true }),
          );
          await batch.commit();
        }
      } catch (error) {
        console.error("Failed to mark messages as read:", error);
        if (conversationRef.current?.id === conversationId) {
          setThreadError(
            "We couldn't update the read status. Your messages are still available.",
          );
        }
      } finally {
        markingReadRef.current.delete(conversationId);
      }
    },
    [],
  );

  const openConversation = useCallback(
    (snapshot: ConversationSnapshot, writeHistory = true) => {
      const currentUser = userRef.current;
      if (!currentUser) return;

      messageUnsubscribeRef.current?.();
      conversationRef.current = snapshot;
      setActiveConversation(snapshot);
      setMessages([]);
      setOlderMessages([]);
      setHasMoreOlder(false);
      setThreadError("");
      setMobileView("thread");
      scrollModeRef.current = "bottom";

      if (writeHistory) updateUrl(snapshot.id);
      void markConversationRead(snapshot.id, currentUser);

      const generation = ++conversationGenerationRef.current;
      void (async () => {
        try {
          const [{ db }, firestore] = await Promise.all([
            import("../../lib/firebase"),
            import("firebase/firestore"),
          ]);
          if (
            generation !== conversationGenerationRef.current ||
            conversationRef.current?.id !== snapshot.id
          ) return;

          messageUnsubscribeRef.current = firestore.onSnapshot(
            firestore.query(
              firestore.collection(
                db,
                "conversations",
                snapshot.id,
                "messages",
              ),
              firestore.orderBy("timestamp", "desc"),
              firestore.limit(50),
            ),
            (messageSnapshot) => {
              if (
                generation !== conversationGenerationRef.current ||
                conversationRef.current?.id !== snapshot.id
              ) return;
              const timeline = timelineRef.current;
              const atBottom = !timeline ||
                timeline.scrollHeight - timeline.scrollTop -
                  timeline.clientHeight < 120;
              scrollModeRef.current = atBottom ? "bottom" : null;
              const nextMessages = [...messageSnapshot.docs].reverse();
              setMessages(nextMessages);
              setHasMoreOlder(
                (hasMore) => messageSnapshot.docs.length === 50 || hasMore,
              );
              const latestIncoming = [...nextMessages]
                .reverse()
                .find((message) => message.data().senderId !== currentUser.uid);
              if (latestIncoming && !latestIncoming.data().isRead) {
                void markConversationRead(snapshot.id, currentUser);
              }
            },
            (error) => {
              console.error("Failed to load conversation messages:", error);
              if (generation === conversationGenerationRef.current) {
                setThreadError(
                  "We couldn't load this conversation. Refresh the page to try again.",
                );
              }
            },
          );
        } catch (error) {
          console.error("Failed to connect to conversation:", error);
          setThreadError(
            "We couldn't load this conversation. Refresh the page to try again.",
          );
        }
      })();
    },
    [markConversationRead, updateUrl],
  );

  useEffect(() => {
    const handlePopState = () => {
      const conversationId = new URL(window.location.href).searchParams.get(
        "conversation",
      );
      if (!conversationId) {
        messageUnsubscribeRef.current?.();
        messageUnsubscribeRef.current = null;
        conversationRef.current = null;
        setActiveConversation(null);
        setMessages([]);
        setOlderMessages([]);
        setMobileView("list");
        return;
      }
      const conversation = conversationsRef.current.find(
        (item) => item.id === conversationId,
      );
      if (conversation) openConversation(conversation, false);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [openConversation]);

  useLayoutEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline) return;
    const mode = scrollModeRef.current;
    if (mode === "bottom") {
      timeline.scrollTop = timeline.scrollHeight;
    } else if (mode === "preserve") {
      timeline.scrollTop +=
        timeline.scrollHeight - lastTimelineHeightRef.current;
    }
    lastTimelineHeightRef.current = timeline.scrollHeight;
    scrollModeRef.current = null;
  }, [messages, olderMessages]);

  const closeConversation = () => {
    messageUnsubscribeRef.current?.();
    messageUnsubscribeRef.current = null;
    conversationGenerationRef.current += 1;
    conversationRef.current = null;
    setActiveConversation(null);
    setMessages([]);
    setOlderMessages([]);
    setMobileView("list");
    updateUrl(null);
  };

  const loadEarlierMessages = async () => {
    if (!activeConversation || loadingOlder || !hasMoreOlder) return;
    const oldest = olderMessages[0] || messages[0];
    if (!oldest) return;
    setLoadingOlder(true);
    try {
      const [{ db }, firestore] = await Promise.all([
        import("../../lib/firebase"),
        import("firebase/firestore"),
      ]);
      const olderSnapshot = await firestore.getDocs(
        firestore.query(
          firestore.collection(
            db,
            "conversations",
            activeConversation.id,
            "messages",
          ),
          firestore.orderBy("timestamp", "desc"),
          firestore.startAfter(oldest),
          firestore.limit(50),
        ),
      );
      lastTimelineHeightRef.current =
        timelineRef.current?.scrollHeight || 0;
      scrollModeRef.current = "preserve";
      setOlderMessages((existing) => [
        ...[...olderSnapshot.docs].reverse(),
        ...existing,
      ]);
      setHasMoreOlder(olderSnapshot.docs.length === 50);
    } catch (error) {
      console.error("Failed to load earlier messages:", error);
      setThreadError("We couldn't load earlier messages. Please try again.");
    } finally {
      setLoadingOlder(false);
    }
  };

  const sendMessage = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const currentUser = userRef.current;
    const conversationSnapshot = conversationRef.current;
    const text = draft.trim();
    if (!currentUser || !conversationSnapshot || !text || sending) return;

    const conversation = conversationSnapshot.data();
    const receiverId = otherParticipantId(conversation, currentUser.uid);
    if (!receiverId) {
      setThreadError("This conversation is missing its other participant.");
      return;
    }

    setSending(true);
    setThreadError("");
    try {
      const [{ db }, firestore] = await Promise.all([
        import("../../lib/firebase"),
        import("firebase/firestore"),
      ]);
      const participantIds = Array.isArray(conversation.participantIds)
        ? conversation.participantIds
        : [currentUser.uid, receiverId].sort();
      await firestore.addDoc(
        firestore.collection(
          db,
          "conversations",
          conversationSnapshot.id,
          "messages",
        ),
        {
          conversationId: conversationSnapshot.id,
          senderId: currentUser.uid,
          senderName:
            conversation.participantNames?.[currentUser.uid] ||
            currentUser.displayName ||
            currentUser.email?.split("@")[0] ||
            "Paddlme member",
          senderAvatarUrl: currentUser.photoURL || null,
          receiverId,
          message: text,
          timestamp: firestore.serverTimestamp(),
          isRead: false,
          equipmentId: conversation.equipmentId || null,
          type: "text",
          participantIds,
        },
      );
      setDraft("");
      if (draftRef.current) draftRef.current.style.height = "";
      scrollModeRef.current = "bottom";
    } catch (error) {
      console.error("Failed to send message:", error);
      setThreadError(
        "Your message couldn't be sent. Check your connection and try again.",
      );
    } finally {
      setSending(false);
      draftRef.current?.focus();
    }
  };

  const deleteConversation = async () => {
    const conversation = conversationRef.current;
    if (!conversation) return;
    if (!window.confirm("Delete this conversation? It will disappear from your inbox.")) {
      return;
    }
    try {
      const [{ db }, firestore] = await Promise.all([
        import("../../lib/firebase"),
        import("firebase/firestore"),
      ]);
      await firestore.deleteDoc(
        firestore.doc(db, "conversations", conversation.id),
      );
      closeConversation();
    } catch (error) {
      console.error("Failed to delete conversation:", error);
      setThreadError("We couldn't delete this conversation. Please try again.");
    }
  };

  const allMessages = [...olderMessages, ...messages]
    .reduce<MessageSnapshot[]>((unique, message) => {
      if (!unique.some((item) => item.id === message.id)) unique.push(message);
      return unique;
    }, [])
    .sort((a, b) => {
      const aTime = asDate(a.data().timestamp)?.getTime() || 0;
      const bTime = asDate(b.data().timestamp)?.getTime() || 0;
      return aTime - bTime;
    });

  const activeData = activeConversation?.data();
  const activeOtherId =
    activeData && user
      ? otherParticipantId(activeData, user.uid)
      : "";
  const activeOtherName = String(
    activeData?.participantNames?.[activeOtherId] || "Paddlme member",
  );
  const activeEquipmentId = String(activeData?.equipmentId || "");
  const activeEquipmentTitle = String(activeData?.equipmentTitle || "");
  const activeEquipmentImage = String(activeData?.equipmentImageUrl || "");

  return (
    <>
      {view === "loading" && (
        <section
          className="rounded-3xl border border-line bg-white px-6 py-16 text-center text-sm font-semibold text-muted shadow-sm"
          role="status"
        >
          Loading your conversations…
        </section>
      )}

      {view === "signed-out" && (
        <section className="rounded-3xl border border-line bg-white px-6 py-14 text-center shadow-sm">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-ocean-50 text-ocean-700">
            <ChatIcon />
          </div>
          <h2 className="mt-5 text-2xl font-extrabold text-ocean-950">
            Your conversations are waiting
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">
            Log in to pick up where you left off or message an equipment owner.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              data-auth="login"
              className="rounded-full bg-ocean-950 px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-ocean-800"
            >
              Log in
            </button>
            <button
              type="button"
              data-auth="signup"
              className="rounded-full border border-line bg-white px-6 py-3 text-sm font-bold text-ink transition-colors hover:bg-[#f6f8f9]"
            >
              Create account
            </button>
          </div>
        </section>
      )}

      {pageError && (
        <div
          className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700"
          role="alert"
        >
          {pageError}
        </div>
      )}

      {view === "inbox" && user && (
        <section
          id="messages-layout"
          className="grid grid-cols-1 gap-4 md:grid-cols-[350px_minmax(0,1fr)]"
          data-view={mobileView}
        >
          <aside
            className="flex h-[min(74vh,760px)] min-h-[480px] flex-col overflow-hidden rounded-3xl border border-line bg-white shadow-sm"
            id="messages-inbox"
          >
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <div>
                <h2 className="font-extrabold text-ocean-950">Inbox</h2>
                <p className="mt-0.5 text-xs text-muted">
                  Your conversations
                </p>
              </div>
              <span className="rounded-full bg-ocean-50 px-2.5 py-1 text-xs font-extrabold text-ocean-700">
                {conversations.length}
              </span>
            </div>

            {conversations.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
                <span className="grid h-14 w-14 place-items-center rounded-2xl bg-[#f3f6f7] text-ocean-500">
                  <ChatIcon />
                </span>
                <p className="mt-4 font-extrabold text-ocean-950">
                  No messages yet
                </p>
                <p className="mt-1 text-sm leading-5 text-muted">
                  Start a conversation from any gear listing.
                </p>
                <a
                  href="/browse"
                  className="mt-4 text-sm font-extrabold text-ocean-700 underline decoration-ocean-200 underline-offset-4"
                >
                  Explore gear
                </a>
              </div>
            ) : (
              <div className="flex flex-1 flex-col space-y-1 overflow-y-auto p-2">
                {conversations.map((snapshot) => {
                  const conversation = snapshot.data();
                  const otherId = otherParticipantId(
                    conversation,
                    user.uid,
                  );
                  const otherName = String(
                    conversation.participantNames?.[otherId] ||
                      "Paddlme member",
                  );
                  const unreadCount = Math.max(
                    0,
                    Number(conversation.unreadCounts?.[user.uid]) || 0,
                  );
                  const lastMessage = conversation.lastMessage || null;
                  const lastText = lastMessage?.message
                    ? String(lastMessage.message)
                    : "Start the conversation";
                  const isMine = lastMessage?.senderId === user.uid;
                  const equipmentTitle = String(
                    conversation.equipmentTitle || "",
                  );
                  const equipmentImage = String(
                    conversation.equipmentImageUrl || "",
                  );
                  const selected = snapshot.id === activeConversation?.id;
                  return (
                    <button
                      type="button"
                      key={snapshot.id}
                      onClick={() => openConversation(snapshot)}
                      className={`flex w-full items-center gap-3 rounded-2xl p-3 text-left transition-colors ${
                        selected ? "bg-ocean-50" : "hover:bg-[#f6f8f9]"
                      }`}
                    >
                      <span className="relative shrink-0">
                        <Avatar
                          imageUrl={conversation.participantAvatars?.[otherId]}
                          name={otherName}
                        />
                        {unreadCount > 0 && (
                          <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full border-2 border-white bg-accent px-1 text-[10px] font-extrabold text-white">
                            {unreadCount > 99 ? "99+" : unreadCount}
                          </span>
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span
                            className={`truncate text-sm ${
                              unreadCount ? "font-extrabold" : "font-bold"
                            } text-ocean-950`}
                          >
                            {otherName}
                          </span>
                          <span
                            className={`shrink-0 text-[10px] ${
                              unreadCount
                                ? "font-extrabold text-ocean-700"
                                : "font-semibold text-muted"
                            }`}
                          >
                            {formatListTimestamp(
                              lastMessage?.timestamp || conversation.updatedAt,
                            )}
                          </span>
                        </span>
                        {equipmentTitle && (
                          <span className="mt-1 block truncate text-[10px] font-bold text-ocean-600">
                            {equipmentTitle}
                          </span>
                        )}
                        <span
                          className={`mt-1 flex items-center truncate text-xs leading-5 ${
                            unreadCount
                              ? "font-semibold text-ink"
                              : "text-muted"
                          }`}
                        >
                          {isMine && (
                            <span
                              className={`mr-1 text-[12px] ${
                                lastMessage?.isRead
                                  ? "text-ocean-500"
                                  : "text-muted"
                              }`}
                              aria-label={
                                lastMessage?.isRead ? "Read" : "Sent"
                              }
                            >
                              {lastMessage?.isRead ? "✓✓" : "✓"}
                            </span>
                          )}
                          <span className="truncate">{lastText}</span>
                        </span>
                      </span>
                      {equipmentImage && (
                        <img
                          src={equipmentImage}
                          alt=""
                          className="h-10 w-10 shrink-0 rounded-xl object-cover"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </aside>

          <section
            className="h-[min(74vh,760px)] min-h-[480px] flex-col overflow-hidden rounded-3xl border border-line bg-white shadow-sm"
            id="messages-thread"
          >
            {!activeConversation ? (
              <div className="flex h-full flex-col items-center justify-center px-6 py-12 text-center">
                <span className="grid h-16 w-16 place-items-center rounded-[22px] bg-ocean-50 text-ocean-700">
                  <ChatIcon className="h-8 w-8" />
                </span>
                <h2 className="mt-5 text-xl font-extrabold text-ocean-950">
                  A better day on the water starts with a conversation
                </h2>
                <p className="mt-2 max-w-sm text-sm leading-6 text-muted">
                  Chat to ask a question, sort out pickup or drop-off, or say thanks
                </p>
              </div>
            ) : (
              <div className="flex h-full min-h-0 flex-col">
                <header className="flex items-center gap-3 border-b border-line px-4 py-3 sm:px-5">
                  <button
                    type="button"
                    onClick={closeConversation}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-[#f6f8f9] md:hidden"
                    aria-label="Back to conversations"
                  >
                    <svg
                      className="h-5 w-5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="m15 18-6-6 6-6" />
                    </svg>
                  </button>
                  <Avatar
                    imageUrl={activeData?.participantAvatars?.[activeOtherId]}
                    name={activeOtherName}
                    size="h-11 w-11"
                  />
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-sm font-extrabold text-ocean-950">
                      {activeOtherName}
                    </h2>
                    <p className="truncate text-xs text-muted">
                      {activeEquipmentTitle ? "Paddlme conversation" : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void deleteConversation()}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-red-50 hover:text-red-700"
                    aria-label="Delete conversation"
                  >
                    <svg
                      className="h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6" />
                    </svg>
                  </button>
                </header>

                {activeEquipmentTitle && (
                  <a
                    href={
                      activeEquipmentId
                        ? `/listing/${encodeURIComponent(activeEquipmentId)}`
                        : "/browse"
                    }
                    className="flex items-center gap-3 border-b border-line bg-[#fbfcfc] px-4 py-3 no-underline transition-colors hover:bg-[#f6f8f9] sm:px-5"
                  >
                    <img
                      src={activeEquipmentImage || "/kayaking.webp"}
                      alt=""
                      className="h-12 w-14 shrink-0 rounded-xl bg-ocean-50 object-cover"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
                        Conversation about
                      </span>
                      <span className="mt-0.5 block truncate text-sm font-extrabold text-ocean-950">
                        {activeEquipmentTitle}
                      </span>
                    </span>
                    <svg
                      className="h-4 w-4 shrink-0 text-muted"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </a>
                )}

                {threadError && (
                  <p
                    className="px-4 pt-3 text-xs font-semibold text-red-700 sm:px-5"
                    role="status"
                  >
                    {threadError}
                  </p>
                )}
                {hasMoreOlder && (
                  <button
                    type="button"
                    onClick={() => void loadEarlierMessages()}
                    disabled={loadingOlder}
                    className="self-center px-4 py-2 text-xs font-extrabold text-ocean-700 hover:text-ocean-950 disabled:opacity-60"
                  >
                    {loadingOlder ? "Loading…" : "Load earlier messages"}
                  </button>
                )}
                <div
                  ref={timelineRef}
                  className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5"
                  role="log"
                  aria-live="polite"
                  aria-relevant="additions text"
                >
                  {allMessages.length === 0 ? (
                    <div className="grid h-full min-h-48 place-items-center text-center">
                      <div>
                        <p className="font-extrabold text-ocean-950">
                          No messages yet
                        </p>
                        <p className="mt-1 text-sm text-muted">
                          Send a message to start the conversation.
                        </p>
                      </div>
                    </div>
                  ) : (
                    allMessages.map((snapshot, index) => {
                      const message = snapshot.data();
                      const date = asDate(message.timestamp) || new Date();
                      const previous = allMessages[index - 1]?.data();
                      const previousDate = asDate(previous?.timestamp);
                      const showDay =
                        !previousDate ||
                        previousDate.toDateString() !== date.toDateString();
                      const mine = message.senderId === user.uid;
                      return (
                        <div key={snapshot.id}>
                          {showDay && (
                            <div className="my-4 flex items-center gap-3">
                              <span className="h-px flex-1 bg-line" />
                              <span className="rounded-full bg-[#f3f5f6] px-3 py-1 text-[10px] font-bold text-muted">
                                {formatDay(date)}
                              </span>
                              <span className="h-px flex-1 bg-line" />
                            </div>
                          )}
                          <div
                            className={`flex ${
                              mine ? "justify-end" : "justify-start"
                            } ${index < allMessages.length - 1 ? "mb-3" : ""}`}
                          >
                            <article
                              className={`max-w-[84%] rounded-2xl px-4 py-2.5 shadow-sm sm:max-w-[76%] ${
                                mine
                                  ? "rounded-br-md bg-ocean-800 text-white"
                                  : "rounded-bl-md border border-line bg-white text-ink"
                              }`}
                            >
                              <p className="whitespace-pre-wrap break-words text-sm leading-6">
                                {String(message.message || "")}
                              </p>
                              <div
                                className={`mt-1 flex items-center justify-end gap-1.5 text-[10px] ${
                                  mine ? "text-white/70" : "text-muted"
                                }`}
                              >
                                <time>{formatTime(date)}</time>
                                {mine && (
                                  <span
                                    aria-label={
                                      message.isRead ? "Read" : "Sent"
                                    }
                                  >
                                    {message.isRead ? "✓✓" : "✓"}
                                  </span>
                                )}
                              </div>
                            </article>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                <form
                  onSubmit={(event) => void sendMessage(event)}
                  className="flex items-end gap-2 border-t border-line bg-white p-3 sm:gap-3 sm:p-4"
                >
                  <label htmlFor="messages-input" className="sr-only">
                    Write a message
                  </label>
                  <textarea
                    ref={draftRef}
                    id="messages-input"
                    rows={1}
                    maxLength={1000}
                    placeholder="Write a message…"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                    onInput={(event) => {
                      event.currentTarget.style.height = "auto";
                      event.currentTarget.style.height = `${Math.min(
                        event.currentTarget.scrollHeight,
                        128,
                      )}px`;
                    }}
                    className="max-h-32 min-h-11 flex-1 resize-y rounded-2xl border border-line bg-[#f8f9fa] px-4 py-3 text-sm leading-5 text-ink outline-none transition-colors placeholder:text-muted focus:border-ocean-500 focus:bg-white"
                    required
                  />
                  <button
                    type="submit"
                    disabled={sending || !draft.trim()}
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ocean-950 text-white transition-colors hover:bg-ocean-800 disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label="Send message"
                  >
                    <svg
                      className="h-5 w-5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="m22 2-7 20-4-9-9-4Z" />
                      <path d="M22 2 11 13" />
                    </svg>
                  </button>
                </form>
              </div>
            )}
          </section>
        </section>
      )}
    </>
  );
}
