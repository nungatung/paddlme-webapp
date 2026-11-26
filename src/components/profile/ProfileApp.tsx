import {
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type SyntheticEvent,
} from "react";
import type { User } from "firebase/auth";
import type { DocumentData, Unsubscribe } from "firebase/firestore";

type RecordWithId = DocumentData & { id: string };
type BookingTab = "pending" | "confirmed" | "active" | "all";
type RentalTab = "upcoming" | "active" | "past";
type Condition = "excellent" | "good" | "fair" | "poor";
type Checklist = {
  id: string;
  bookingId: string;
  equipmentId: string;
  ownerId: string;
  renterId: string;
  condition: Condition;
  damageNotes: string;
  allIncludedGearProvided: boolean;
  emergencyProceduresExplained: boolean;
  equipmentUsageExplained: boolean;
  returnTimeExplained: boolean;
  localHazardsExplained: boolean;
  ownerConfirmsSafeCondition: boolean;
  renterConfirmsInspection: boolean;
  status: string;
};

const statusStyles: Record<string, string> = {
  pending: "bg-amber-50 text-amber-800",
  confirmed: "bg-blue-50 text-blue-800",
  active: "bg-emerald-50 text-emerald-800",
  completed: "bg-gray-100 text-gray-700",
  cancelled: "bg-red-50 text-red-700",
  declined: "bg-red-50 text-red-700",
  closed: "bg-gray-100 text-gray-700",
};

const statusLabels: Record<string, string> = {
  pending: "Pending approval",
  confirmed: "Confirmed",
  active: "Active",
  completed: "Completed",
  cancelled: "Cancelled",
  declined: "Declined",
  closed: "Closed",
};

function displayText(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

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
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function formatDate(value: unknown): string {
  const date = asDate(value);
  if (!date) return "Date not available";
  return new Intl.DateTimeFormat("en-NZ", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatBookingWindow(booking: RecordWithId): string {
  const start = formatDate(booking.startDate);
  const end = formatDate(booking.endDate);
  const startTime = displayText(booking.startTime);
  const endTime = displayText(booking.endTime);
  return start === end
    ? `${start} · ${startTime}–${endTime}`
    : `${start} ${startTime} – ${end} ${endTime}`;
}

function formatPrice(value: unknown): string {
  const amount = typeof value === "number" ? value : Number(value) || 0;
  return new Intl.NumberFormat("en-NZ", {
    style: "currency",
    currency: "NZD",
    maximumFractionDigits: 0,
  }).format(amount);
}

function stars(rating: number): string {
  const filled = Math.round(Math.min(5, Math.max(0, rating)));
  return `${"★".repeat(filled)}${"☆".repeat(5 - filled)}`;
}

function Avatar({
  name,
  image,
  className = "h-24 w-24 text-3xl",
}: {
  name: string;
  image: string;
  className?: string;
}) {
  const initial = name.trim().charAt(0).toUpperCase() || "P";
  return image ? (
    <img
      src={image}
      alt=""
      className={`${className} shrink-0 rounded-full border-4 border-white bg-ocean-50 object-cover shadow-[0_8px_24px_rgba(0,37,58,0.12)]`}
    />
  ) : (
    <span
      aria-label={name}
      className={`${className} grid shrink-0 place-items-center rounded-full border-4 border-white bg-ocean-50 font-extrabold text-ocean-700 shadow-[0_8px_24px_rgba(0,37,58,0.12)]`}
    >
      {initial}
    </span>
  );
}

function BookingDates({ booking }: { booking: RecordWithId }) {
  return (
    <p className="mt-1 text-sm text-muted">{formatBookingWindow(booking)}</p>
  );
}

function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="grid min-h-36 place-items-center rounded-2xl bg-[#f8f9fa] px-4 py-7 text-center">
      <div>
        <p className="font-extrabold text-ocean-950">{title}</p>
        <p className="mt-1 text-sm text-muted">{description}</p>
        {action}
      </div>
    </div>
  );
}

export default function ProfileApp() {
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<"loading" | "signed-out" | "ready">("loading");
  const [profile, setProfile] = useState<Record<string, unknown>>({});
  const [ownerBookings, setOwnerBookings] = useState<RecordWithId[]>([]);
  const [renterBookings, setRenterBookings] = useState<RecordWithId[]>([]);
  const [listings, setListings] = useState<RecordWithId[]>([]);
  const [reviews, setReviews] = useState<RecordWithId[]>([]);
  const [rentalTab, setRentalTab] = useState<RentalTab>("upcoming");
  const [bookingTab, setBookingTab] = useState<BookingTab>("pending");
  const [pageError, setPageError] = useState("");
  const [listingError, setListingError] = useState("");
  const [reviewError, setReviewError] = useState("");
  const [bookingsError, setBookingsError] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editError, setEditError] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [bio, setBio] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState("");
  const [declineBooking, setDeclineBooking] = useState<RecordWithId | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [returnBooking, setReturnBooking] = useState<RecordWithId | null>(null);
  const [reviewBooking, setReviewBooking] = useState<RecordWithId | null>(null);
  const [reviewNotice, setReviewNotice] = useState("");
  const [handoverBooking, setHandoverBooking] = useState<RecordWithId | null>(null);
  const [actionBusy, setActionBusy] = useState("");
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let authUnsubscribe: Unsubscribe | undefined;
    let renterUnsubscribe: Unsubscribe | undefined;
    let ownerUnsubscribe: Unsubscribe | undefined;
    let loadVersion = 0;

    void (async () => {
      try {
        const [{ auth, db }, authModule, firestore] = await Promise.all([
          import("../../lib/firebase"),
          import("firebase/auth"),
          import("firebase/firestore"),
        ]);
        if (cancelled) return;

        authUnsubscribe = authModule.onAuthStateChanged(
          auth,
          (nextUser) => {
            const version = ++loadVersion;
            renterUnsubscribe?.();
            ownerUnsubscribe?.();
            renterUnsubscribe = undefined;
            ownerUnsubscribe = undefined;
            setUser(nextUser);
            setProfile({});
            setOwnerBookings([]);
            setRenterBookings([]);
            setListings([]);
            setReviews([]);
            setPageError("");
            setListingError("");
            setReviewError("");
            setBookingsError("");

            if (!nextUser) {
              setView("signed-out");
              return;
            }

            setView("ready");
            const bookingsRef = firestore.collection(db, "bookings");
            renterUnsubscribe = firestore.onSnapshot(
              firestore.query(
                bookingsRef,
                firestore.where("renterId", "==", nextUser.uid),
                firestore.orderBy("bookingDate", "desc"),
              ),
              (snapshot) => {
                if (!cancelled && version === loadVersion) {
                  setRenterBookings(
                    snapshot.docs.map((item) => ({
                      id: item.id,
                      ...item.data(),
                    })),
                  );
                }
              },
              (error) => {
                console.error("Failed to load renter bookings:", error);
                if (!cancelled && version === loadVersion) {
                  setBookingsError(
                    "We couldn't load your bookings. Refresh the page to try again.",
                  );
                }
              },
            );
            ownerUnsubscribe = firestore.onSnapshot(
              firestore.query(
                bookingsRef,
                firestore.where("ownerId", "==", nextUser.uid),
                firestore.orderBy("bookingDate", "desc"),
              ),
              (snapshot) => {
                if (!cancelled && version === loadVersion) {
                  setOwnerBookings(
                    snapshot.docs.map((item) => ({
                      id: item.id,
                      ...item.data(),
                    })),
                  );
                }
              },
              (error) => {
                console.error("Failed to load owner bookings:", error);
                if (!cancelled && version === loadVersion) {
                  setBookingsError(
                    "We couldn't load bookings you're hosting. Refresh the page to try again.",
                  );
                }
              },
            );

            void (async () => {
              try {
                const userSnapshot = await firestore.getDoc(
                  firestore.doc(db, "users", nextUser.uid),
                );
                if (cancelled || version !== loadVersion) return;
                setProfile(
                  userSnapshot.data() || {
                    uid: nextUser.uid,
                    email: nextUser.email || "",
                    name: nextUser.displayName || "",
                    profileImageUrl: nextUser.photoURL || null,
                    rating: 0,
                    reviewCount: 0,
                  },
                );
              } catch (error) {
                console.error("Failed to load profile details:", error);
                if (!cancelled && version === loadVersion) {
                  setPageError(
                    "Some profile details couldn't be loaded. You can still view your activity below.",
                  );
                }
              }

              try {
                const listingSnapshot = await firestore.getDocs(
                  firestore.query(
                    firestore.collection(db, "equipment"),
                    firestore.where("ownerId", "==", nextUser.uid),
                    firestore.orderBy("createdAt", "desc"),
                  ),
                );
                if (!cancelled && version === loadVersion) {
                  setListings(
                    listingSnapshot.docs.map((item) => ({
                      id: item.id,
                      ...item.data(),
                    })),
                  );
                }
              } catch (error) {
                console.error("Failed to load user listings:", error);
                if (!cancelled && version === loadVersion) {
                  setListingError(
                    "We couldn't load your listings. Refresh the page to try again.",
                  );
                }
              }

              try {
                const reviewSnapshot = await firestore.getDocs(
                  firestore.query(
                    firestore.collection(db, "reviews"),
                    firestore.where("reviewedId", "==", nextUser.uid),
                    firestore.orderBy("createdAt", "desc"),
                  ),
                );
                if (!cancelled && version === loadVersion) {
                  setReviews(
                    reviewSnapshot.docs.map((item) => ({
                      id: item.id,
                      ...item.data(),
                    })),
                  );
                }
              } catch (error) {
                console.error("Failed to load user reviews:", error);
                if (!cancelled && version === loadVersion) {
                  setReviewError(
                    "We couldn't load your reviews. Refresh the page to try again.",
                  );
                }
              }
            })();
          },
          (error) => {
            console.error("Failed to check authentication:", error);
            if (!cancelled) {
              setPageError(
                "We couldn't connect to your account. Refresh the page to try again.",
              );
              setView("signed-out");
            }
          },
        );
      } catch (error) {
        console.error("Failed to initialize profile:", error);
        if (!cancelled) {
          setPageError(
            "We couldn't connect to your account. Refresh the page to try again.",
          );
          setView("signed-out");
        }
      }
    })();

    return () => {
      cancelled = true;
      authUnsubscribe?.();
      renterUnsubscribe?.();
      ownerUnsubscribe?.();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setEditOpen(false);
        setDeclineBooking(null);
        setReturnBooking(null);
        setReviewBooking(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    return () => {
      if (avatarPreview.startsWith("blob:")) URL.revokeObjectURL(avatarPreview);
    };
  }, [avatarPreview]);

  const displayName = displayText(
    profile.name,
    user?.displayName || "Paddlme member",
  );
  const email = displayText(profile.email, user?.email || "");
  const profileLocation = displayText(profile.location);
  const profileBio = displayText(profile.bio);
  const profileImage = displayText(
    profile.profileImageUrl,
    user?.photoURL || "",
  );
  const rating = Math.min(5, Math.max(0, Number(profile.rating) || 0));
  const reviewCount = Math.max(
    0,
    Number(profile.reviewCount) || reviews.length,
  );
  const pendingCount = ownerBookings.filter(
    (booking) => booking.status === "pending",
  ).length;
  const filteredRenterBookings = useMemo(
    () =>
      renterBookings.filter((booking) => {
        if (rentalTab === "upcoming") {
          return booking.status === "pending" || booking.status === "confirmed";
        }
        if (rentalTab === "active") return booking.status === "active";
        return ["completed", "cancelled", "declined", "closed"].includes(
          String(booking.status),
        );
      }),
    [renterBookings, rentalTab],
  );
  const filteredOwnerBookings = useMemo(
    () =>
      bookingTab === "all"
        ? ownerBookings
        : ownerBookings.filter((booking) => booking.status === bookingTab),
    [bookingTab, ownerBookings],
  );

  function openEditProfile() {
    if (!user) return;
    setName(displayText(profile.name, user.displayName || ""));
    setLocation(displayText(profile.location));
    setBio(displayText(profile.bio));
    setAvatarFile(null);
    setAvatarPreview(profileImage);
    setEditError("");
    setEditOpen(true);
  }

  function selectAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) {
      setEditError("Choose an image file smaller than 5 MB.");
      event.target.value = "";
      return;
    }
    setEditError("");
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  }

  async function saveProfile(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    const cleanName = name.trim();
    if (!cleanName) {
      setEditError("Please enter your name.");
      return;
    }
    setSavingProfile(true);
    setEditError("");
    try {
      const [{ db }, authModule, storageModule, firestore] = await Promise.all([
        import("../../lib/firebase"),
        import("firebase/auth"),
        import("firebase/storage"),
        import("firebase/firestore"),
      ]);
      let profileImageUrl = profileImage;
      if (avatarFile) {
        const uploaded = await storageModule.uploadBytes(
          storageModule.ref(
            storageModule.getStorage(),
            `profile_pictures/profile_${user.uid}.jpg`,
          ),
          avatarFile,
          { contentType: avatarFile.type },
        );
        profileImageUrl = await storageModule.getDownloadURL(uploaded.ref);
      }
      const nextProfile = {
        uid: user.uid,
        email: user.email || "",
        name: cleanName,
        profileImageUrl: profileImageUrl || null,
        bio: bio.trim() || null,
        location: location.trim() || null,
      };
      await firestore.setDoc(
        firestore.doc(db, "users", user.uid),
        nextProfile,
        { merge: true },
      );
      await authModule.updateProfile(user, {
        displayName: cleanName,
        photoURL: profileImageUrl || null,
      });
      setProfile((current) => ({ ...current, ...nextProfile }));
      setEditOpen(false);
    } catch (error) {
      console.error("Failed to update profile:", error);
      setEditError(
        "We couldn't save your profile. Check your connection and try again.",
      );
    } finally {
      setSavingProfile(false);
    }
  }

  async function acceptBooking(booking: RecordWithId) {
    setActionBusy(booking.id);
    setActionError("");
    try {
      const [{ db }, firestore] = await Promise.all([
        import("../../lib/firebase"),
        import("firebase/firestore"),
      ]);
      await firestore.updateDoc(firestore.doc(db, "bookings", booking.id), {
        status: "confirmed",
        confirmedDate: firestore.serverTimestamp(),
        updatedAt: firestore.serverTimestamp(),
      });
    } catch (error) {
      console.error("Failed to confirm booking:", error);
      setActionError("We couldn't confirm this booking. Please try again.");
    } finally {
      setActionBusy("");
    }
  }

  async function confirmDecline() {
    if (!declineBooking) return;
    setActionBusy(declineBooking.id);
    setActionError("");
    try {
      const [{ db }, firestore] = await Promise.all([
        import("../../lib/firebase"),
        import("firebase/firestore"),
      ]);
      await firestore.updateDoc(
        firestore.doc(db, "bookings", declineBooking.id),
        {
          status: "declined",
          cancellationReason: declineReason.trim() || "Not available",
          updatedAt: firestore.serverTimestamp(),
        },
      );
      setDeclineBooking(null);
      setDeclineReason("");
    } catch (error) {
      console.error("Failed to decline booking:", error);
      setActionError("We couldn't decline this request. Please try again.");
    } finally {
      setActionBusy("");
    }
  }

  async function confirmReturn() {
    if (!returnBooking) return;
    setActionBusy(returnBooking.id);
    setActionError("");
    try {
      const [{ db }, firestore] = await Promise.all([
        import("../../lib/firebase"),
        import("firebase/firestore"),
      ]);
      await firestore.updateDoc(
        firestore.doc(db, "bookings", returnBooking.id),
        {
          status: "completed",
          returnedAt: firestore.serverTimestamp(),
          updatedAt: firestore.serverTimestamp(),
        },
      );
      setReturnBooking(null);
    } catch (error) {
      console.error("Failed to mark booking returned:", error);
      setActionError(
        "We couldn't mark this booking as returned. Please try again.",
      );
    } finally {
      setActionBusy("");
    }
  }

  async function messageRenter(booking: RecordWithId) {
    if (!user) return;
    setActionBusy(booking.id);
    setActionError("");
    try {
      const [{ db }, firestore] = await Promise.all([
        import("../../lib/firebase"),
        import("firebase/firestore"),
      ]);
      const participantIds = [user.uid, String(booking.renterId || "")].sort();
      const otherUserId = participantIds.find((id) => id !== user.uid);
      if (!otherUserId) throw new Error("Booking renter is missing.");
      const conversationId = participantIds.join("_");
      const conversationRef = firestore.doc(
        db,
        "conversations",
        conversationId,
      );
      const conversationSnapshot = await firestore.getDoc(conversationRef);
      if (!conversationSnapshot.exists()) {
        const senderName =
          user.displayName || user.email?.split("@")[0] || "Paddlme member";
        await firestore.setDoc(conversationRef, {
          participantIds,
          participantNames: {
            [user.uid]: senderName,
            [otherUserId]: displayText(booking.renterName, "Renter"),
          },
          participantAvatars: {
            [user.uid]: user.photoURL || null,
            [otherUserId]: null,
          },
          equipmentId: displayText(booking.equipmentId),
          equipmentTitle: displayText(booking.equipmentTitle, "Gear"),
          equipmentImageUrl: displayText(booking.equipmentImageUrl) || null,
          unreadCounts: { [user.uid]: 0, [otherUserId]: 0 },
          createdAt: firestore.serverTimestamp(),
          updatedAt: firestore.serverTimestamp(),
        });
      }
      window.location.assign(
        `/messages?conversation=${encodeURIComponent(conversationId)}`,
      );
    } catch (error) {
      console.error("Failed to open renter conversation:", error);
      setActionError(
        "We couldn't open a conversation with this renter. Please try again.",
      );
      setActionBusy("");
    }
  }

  const editModal = editOpen && (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-ocean-950/60 p-3 backdrop-blur-[2px] sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-edit-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setEditOpen(false);
      }}
    >
      <div className="flex min-h-full items-center justify-center">
        <section className="w-full max-w-xl overflow-hidden rounded-3xl bg-white shadow-2xl">
          <form onSubmit={saveProfile}>
            <div className="flex items-center justify-between border-b border-line px-5 py-4 sm:px-7">
              <div>
                <h2
                  id="profile-edit-title"
                  className="mt-0.5 text-lg font-extrabold text-ocean-950"
                >
                  Edit profile
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setEditOpen(false)}
                className="cursor-pointer grid h-10 w-10 place-items-center rounded-full text-muted hover:bg-[#f6f8f9]"
                aria-label="Close edit profile"
              >
                ×
              </button>
            </div>
            <div className="max-h-[calc(100vh-7rem)] space-y-4 overflow-y-auto px-5 py-5 sm:px-7">
              {editError && (
                <p className="rounded-lg bg-red-50 px-3 py-2.5 text-sm font-semibold text-red-700" role="alert">
                  {editError}
                </p>
              )}
              <div className="flex items-center gap-4">
                <Avatar
                  name={name || "Paddlme member"}
                  image={avatarPreview}
                  className="h-16 w-16 text-lg"
                />
                <label className="cursor-pointer rounded-full border border-line px-4 py-2.5 text-sm font-bold text-ink transition-colors hover:bg-[#f6f8f9]">
                  Change photo
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={selectAvatar}
                  />
                </label>
                <span className="text-xs text-muted">JPG, PNG or WebP · up to 5 MB</span>
              </div>
              <div>
                <label htmlFor="profile-edit-name" className="mb-1.5 block text-sm font-bold text-ink">
                  Full name
                </label>
                <input
                  id="profile-edit-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  maxLength={80}
                  className="auth-input"
                />
              </div>
              <div>
                <label htmlFor="profile-edit-location" className="mb-1.5 block text-sm font-bold text-ink">
                  Location
                </label>
                <input
                  id="profile-edit-location"
                  value={location}
                  onChange={(event) => setLocation(event.target.value)}
                  maxLength={120}
                  placeholder="Town or region"
                  className="auth-input"
                />
              </div>
              <div>
                <label htmlFor="profile-edit-bio" className="mb-1.5 block text-sm font-bold text-ink">
                  About you
                </label>
                <textarea
                  id="profile-edit-bio"
                  value={bio}
                  onChange={(event) => setBio(event.target.value)}
                  rows={4}
                  maxLength={600}
                  placeholder="Tell the Paddlme community a little about yourself…"
                  className="auth-input resize-y"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-line px-5 py-4 sm:px-7">
              <button
                type="button"
                onClick={() => setEditOpen(false)}
                className="cursor-pointer rounded-full px-4 py-2.5 text-sm font-bold text-muted hover:bg-[#f6f8f9]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingProfile}
                className="cursor-pointer rounded-full bg-accent px-5 py-2.5 text-sm font-extrabold text-white transition-[filter] hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingProfile ? "Saving…" : "Save changes"}
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );

  if (view === "loading") {
    return (
      <div className="rounded-2xl border border-line bg-white px-6 py-12 text-center text-sm font-semibold text-muted shadow-sm" role="status">
        Loading your profile…
      </div>
    );
  }

  if (view === "signed-out") {
    return (
      <>
        {pageError && (
          <p className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700" role="alert">
            {pageError}
          </p>
        )}
        <section className="rounded-3xl border border-line bg-white px-6 py-14 text-center shadow-sm">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-ocean-50 text-ocean-700" aria-hidden="true">
            <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </div>
          <h2 className="mt-5 text-2xl font-extrabold text-ocean-950">Your Paddlme, in one place</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">
            Log in to see your profile, reviews, rentals and listings—or create an account to get started.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button type="button" data-auth="login" className="rounded-full bg-ocean-950 px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-ocean-800">
              Log in
            </button>
            <button type="button" data-auth="signup" className="rounded-full border border-line bg-white px-6 py-3 text-sm font-bold text-ink transition-colors hover:bg-[#f6f8f9]">
              Create account
            </button>
          </div>
        </section>
      </>
    );
  }

  const averageReviewRating =
    reviews.length > 0
      ? reviews.reduce(
          (sum, review) => sum + (Number(review.rating) || 0),
          0,
        ) / reviews.length
      : 0;
  const shownRating = rating || averageReviewRating;

  return (
    <>
      {pageError && (
        <p className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700" role="alert">
          {pageError}
        </p>
      )}

      <div className="space-y-5">
        <section className="overflow-hidden rounded-3xl border border-line bg-white shadow-sm">
          <div className="h-2 bg-gradient-to-r from-ocean-700 via-ocean-500 to-accent" />
          <div className="p-5 sm:p-8">
            <div className="flex flex-col items-center gap-5 text-center sm:flex-row sm:items-start sm:text-left">
              <Avatar name={displayName} image={profileImage} />
              <div className="min-w-0 flex-1">
                <h2 className="mt-1 break-words text-2xl font-extrabold tracking-tight text-ocean-950">
                  {displayName}
                </h2>
                <p className="mt-1 break-all text-sm font-medium text-muted">{email}</p>
                {profileLocation && (
                  <p className="mt-3 flex items-center justify-center gap-1.5 text-sm font-semibold text-ink sm:justify-start">
                    <span aria-hidden="true">⌖</span>
                    {profileLocation}
                  </p>
                )}
                {profileBio && (
                  <p className="mt-4 whitespace-pre-line text-sm leading-6 text-muted">{profileBio}</p>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap justify-center gap-2 sm:justify-end">
                <button
                  type="button"
                  onClick={openEditProfile}
                  className="cursor-pointer rounded-full border border-line bg-white px-4 py-2.5 text-sm font-bold text-ink transition-colors hover:border-ocean-500 hover:bg-[#f6f8f9]"
                >
                  Edit profile
                </button>
                <a
                  href="#profile-reviews"
                  className="inline-flex items-center gap-1.5 rounded-full border border-accent/20 bg-accent/10 px-4 py-2.5 text-sm font-extrabold text-ocean-950 no-underline transition-colors hover:bg-accent/15"
                >
                  <span className="whitespace-nowrap text-accent" aria-label={`${shownRating.toFixed(1)} out of 5 stars`}>
                    {shownRating ? stars(shownRating) : "☆☆☆☆☆"}
                  </span>
                  <span>{shownRating ? shownRating.toFixed(1) : "New"}</span>
                  <span className="text-muted">
                    ({reviewCount > 0 ? `${reviewCount} ${reviewCount === 1 ? "review" : "reviews"}` : "No reviews"})
                  </span>
                </a>
              </div>
            </div>
          </div>
        </section>

        {/*<section className="grid gap-4 sm:grid-cols-3" aria-label="Profile overview">
          <a href="#owner-bookings" className="rounded-2xl border border-line bg-white p-5 text-left no-underline shadow-sm transition-colors hover:border-ocean-500">
            <p className="text-xs font-bold uppercase tracking-wider text-muted">Incoming requests</p>
            <p className="mt-2 text-3xl font-extrabold text-ocean-950">{pendingCount}</p>
            <p className="mt-1 text-sm text-muted">Bookings waiting for your response</p>
          </a>
          <a href="#profile-listings" className="rounded-2xl border border-line bg-white p-5 text-left no-underline shadow-sm transition-colors hover:border-ocean-500">
            <p className="text-xs font-bold uppercase tracking-wider text-muted">Your listings</p>
            <p className="mt-2 text-3xl font-extrabold text-ocean-950">{listings.length}</p>
            <p className="mt-1 text-sm text-muted">Available listings</p>
          </a>
          <a href="#renter-bookings" className="rounded-2xl border border-line bg-white p-5 text-left no-underline shadow-sm transition-colors hover:border-ocean-500">
            <p className="text-xs font-bold uppercase tracking-wider text-muted">Your rentals</p>
            <p className="mt-2 text-3xl font-extrabold text-ocean-950">{renterBookings.length}</p>
            <p className="mt-1 text-sm text-muted">Bookings you’ve requested</p>
          </a>
        </section>*/}

        <section id="owner-bookings" className="scroll-mt-24 rounded-3xl border border-line bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 sm:px-7 sm:pt-7">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-ocean-50 text-ocean-700" aria-hidden="true">↗</span>
              <div>
                <h2 className="text-lg font-extrabold text-ocean-950">Manage bookings</h2>
                <p className="text-xs text-muted">Incoming rental requests</p>
              </div>
            </div>
            {pendingCount > 0 && (
              <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-extrabold text-amber-800">
                {pendingCount} awaiting response
              </span>
            )}
          </div>
          <div className="mt-5 flex overflow-x-auto border-b border-line px-3 sm:px-5" role="tablist" aria-label="Bookings you manage">
            {(["pending", "confirmed", "active", "all"] as const).map((tab) => (
              <button
                type="button"
                key={tab}
                role="tab"
                aria-selected={bookingTab === tab}
                onClick={() => setBookingTab(tab)}
                className={`cursor-pointer shrink-0 border-b-2 px-4 py-3 text-sm capitalize transition-colors sm:px-5 ${
                  bookingTab === tab
                    ? "border-ocean-700 font-bold text-ocean-950"
                    : "border-transparent font-semibold text-muted hover:text-ocean-950"
                }`}
              >
                {tab === "all" ? "All" : tab}
                {tab === "pending" && pendingCount > 0 ? ` (${pendingCount})` : ""}
              </button>
            ))}
          </div>
          <div className="p-4 sm:p-6" role="tabpanel">
            {bookingsError && (
              <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700" role="alert">
                {bookingsError}
              </p>
            )}
            {actionError && (
              <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700" role="alert">
                {actionError}
              </p>
            )}
            {reviewNotice && (
              <p className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800" role="status">
                {reviewNotice}
              </p>
            )}
            {filteredOwnerBookings.length === 0 ? (
              <EmptyState
                title={
                  bookingTab === "pending"
                    ? "No pending requests"
                    : bookingTab === "confirmed"
                      ? "No confirmed bookings"
                      : bookingTab === "active"
                        ? "No active rentals"
                        : "No bookings yet"
                }
                description={
                  bookingTab === "pending"
                    ? "New booking requests will appear here"
                    : bookingTab === "confirmed"
                      ? "Confirmed bookings awaiting handover will appear here"
                      : bookingTab === "active"
                        ? "Active rentals will appear here"
                        : "Your booking history will appear here"
                }
              />
            ) : (
              <div className="space-y-3">
                {filteredOwnerBookings.map((booking) => (
                  <OwnerBookingCard
                    key={booking.id}
                    booking={booking}
                    busy={actionBusy === booking.id}
                    onAccept={() => void acceptBooking(booking)}
                    onDecline={() => {
                      setActionError("");
                      setDeclineReason("");
                      setDeclineBooking(booking);
                    }}
                    onMessage={() => void messageRenter(booking)}
                    onHandover={() => setHandoverBooking(booking)}
                    onReview={() => {
                      setReviewNotice("");
                      setReviewBooking(booking);
                    }}
                    onReturn={() => {
                      setActionError("");
                      setReturnBooking(booking);
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        <section id="renter-bookings" className="scroll-mt-24 rounded-3xl border border-line bg-white shadow-sm">
          <div className="flex items-center gap-3 px-5 pt-5 sm:px-7 sm:pt-7">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700" aria-hidden="true">▦</span>
            <div>
              <h2 className="text-lg font-extrabold text-ocean-950">Your rentals</h2>
              <p className="text-xs text-muted">Keep track of your bookings</p>
            </div>
          </div>
          <div className="mt-5 flex border-b border-line px-3 sm:px-5" role="tablist" aria-label="Rental history">
            {(["upcoming", "active", "past"] as const).map((tab) => (
              <button
                type="button"
                key={tab}
                role="tab"
                aria-selected={rentalTab === tab}
                onClick={() => setRentalTab(tab)}
                className={`cursor-pointer border-b-2 px-3 py-3 text-sm capitalize transition-colors sm:px-5 ${
                  rentalTab === tab
                    ? "border-ocean-700 font-bold text-ocean-950"
                    : "border-transparent font-semibold text-muted hover:text-ocean-950"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
          <div className="min-h-36 p-4 sm:p-6" role="tabpanel">
            {bookingsError && (
              <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700" role="alert">
                {bookingsError}
              </p>
            )}
            {filteredRenterBookings.length === 0 ? (
              <EmptyState
                title={`No ${rentalTab === "upcoming" ? "upcoming" : rentalTab} rentals`}
                description={
                  rentalTab === "upcoming"
                    ? "Your booking requests will show here"
                    : rentalTab === "active"
                      ? "Active bookings will show here"
                      : "Your rental history will show here"
                }
                action={
                  <a href="/browse" className="mt-4 inline-flex rounded-full bg-ocean-950 px-5 py-2.5 text-sm font-bold text-white no-underline hover:bg-ocean-800">
                    Browse gear
                  </a>
                }
              />
            ) : (
              <div className="space-y-3">
                {filteredRenterBookings.map((booking) => (
                  <RenterBookingCard key={booking.id} booking={booking} />
                ))}
              </div>
            )}
          </div>
        </section>

        <section id="profile-listings" className="scroll-mt-24 rounded-3xl border border-line bg-white p-5 shadow-sm sm:p-7" aria-labelledby="profile-listings-heading">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 id="profile-listings-heading" className="mt-1 text-lg font-extrabold text-ocean-950">My listings</h2>
            </div>
            <span className="rounded-full bg-ocean-50 px-3 py-1 text-xs font-extrabold text-ocean-700">
              {listings.length} {listings.length === 1 ? "listing" : "listings"}
            </span>
          </div>
          {listingError ? (
            <p className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700" role="alert">{listingError}</p>
          ) : listings.length === 0 ? (
            <p className="mt-5 rounded-2xl border border-dashed border-line bg-[#f8f9fa] px-4 py-8 text-center text-sm text-muted">
              You haven’t shared any gear yet.
            </p>
          ) : (
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {listings.map((item) => {
                const images = Array.isArray(item.imageUrls) ? item.imageUrls : [];
                const title = displayText(item.title, "Untitled gear");
                const image = displayText(images[0], "/kayaking.webp");
                const available = item.isAvailable !== false;
                return (
                  <a key={item.id} href={`/listing/${encodeURIComponent(item.id)}`} className="group overflow-hidden rounded-2xl border border-line bg-white text-left no-underline transition-all hover:-translate-y-0.5 hover:border-ocean-500 hover:shadow-[0_10px_24px_rgba(0,37,58,0.10)]">
                    <div className="relative aspect-[16/10] overflow-hidden bg-ocean-50">
                      <img src={image} alt={title} loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                      <span className="absolute left-2.5 top-2.5 rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-ocean-950 shadow-sm">
                        {displayText(item.category, "Equipment")}
                      </span>
                    </div>
                    <div className="p-4">
                      <h3 className="truncate text-sm font-extrabold text-ocean-950">{title}</h3>
                      <p className="mt-1 truncate text-xs text-muted">{displayText(item.location, "New Zealand")}</p>
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <p className="text-sm font-extrabold text-ocean-950">
                          {formatPrice(item.pricePerHour)}
                          <span className="text-[13px] font-semibold text-muted"> /hour</span>
                        </p>
                        <span className={`text-[10px] font-bold ${available ? "text-emerald-700" : "text-muted"}`}>
                          {available ? "Available" : "Unavailable"}
                        </span>
                      </div>
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </section>

        <section id="profile-reviews" className="scroll-mt-24 rounded-3xl border border-line bg-white p-5 shadow-sm sm:p-7" aria-labelledby="profile-reviews-heading">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 id="profile-reviews-heading" className="mt-1 text-lg font-extrabold text-ocean-950">Your reviews</h2>
            </div>
            <span className="text-sm font-bold text-muted">
              {reviewCount} {reviewCount === 1 ? "review" : "reviews"}
            </span>
          </div>
          <div className="mt-5 space-y-3">
            {reviewError ? (
              <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700" role="alert">{reviewError}</p>
            ) : reviews.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-line bg-[#f8f9fa] px-4 py-8 text-center text-sm text-muted">
                Reviews from the Paddlme community will appear here.
              </p>
            ) : (
              reviews.map((review) => {
                const reviewer = displayText(review.reviewerName, "Paddlme member");
                const reviewRating = Math.min(5, Math.max(0, Number(review.rating) || 0));
                const comment = displayText(review.comment);
                return (
                  <article key={review.id} className="rounded-2xl border border-line bg-white p-4 sm:p-5">
                    <div className="flex items-start gap-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ocean-50 text-sm font-extrabold text-ocean-700">
                        {reviewer.trim().charAt(0).toUpperCase() || "P"}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                          <h3 className="text-sm font-extrabold text-ocean-950">{reviewer}</h3>
                          <time className="text-xs font-medium text-muted">{formatDate(review.createdAt)}</time>
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <span className="tracking-[0.12em] text-accent" aria-label={`${reviewRating} out of 5 stars`}>{stars(reviewRating)}</span>
                          <span className="text-xs font-bold text-ink">{reviewRating.toFixed(1)}</span>
                        </div>
                      </div>
                    </div>
                    {comment && <p className="mt-3 whitespace-pre-line text-sm leading-6 text-ink">{comment}</p>}
                  </article>
                );
              })
            )}
          </div>
        </section>

        <section className="flex flex-col items-start justify-between gap-4 rounded-3xl bg-ocean-950 p-5 text-white sm:flex-row sm:items-center sm:p-7">
          <div>
            <p className="text-sm font-extrabold">Account settings</p>
            <p className="mt-1 text-sm text-white/70">Update your public profile or sign out of Paddlme.</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={openEditProfile} className="cursor-pointer rounded-full border border-white/25 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-white/10">
              Edit profile
            </button>
            <button type="button" data-auth-signout className="cursor-pointer rounded-full bg-white px-4 py-2.5 text-sm font-bold text-ocean-950 transition-colors hover:bg-ocean-50">
              Sign out
            </button>
          </div>
        </section>
      </div>

      {editModal}

      {declineBooking && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ocean-950/60 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-labelledby="decline-title" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setDeclineBooking(null);
        }}>
          <section className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-muted">Booking request</p>
            <h2 id="decline-title" className="mt-1 text-xl font-extrabold text-ocean-950">Decline this booking?</h2>
            <p className="mt-2 text-sm leading-6 text-muted">Add a reason for the renter. If left blank, we’ll use “Not available”.</p>
            <label htmlFor="decline-reason" className="mt-5 block text-sm font-bold text-ink">Reason (optional)</label>
            <textarea id="decline-reason" value={declineReason} onChange={(event) => setDeclineReason(event.target.value)} maxLength={300} rows={3} className="auth-input mt-2 resize-y" />
            {actionError && <p className="mt-3 text-sm font-semibold text-red-700" role="alert">{actionError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setDeclineBooking(null)} className="rounded-full border border-line px-4 py-2.5 text-sm font-bold text-ink hover:bg-[#f6f8f9]">Keep request</button>
              <button type="button" disabled={actionBusy === declineBooking.id} onClick={() => void confirmDecline()} className="rounded-full bg-red-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-60">
                {actionBusy === declineBooking.id ? "Declining…" : "Decline request"}
              </button>
            </div>
          </section>
        </div>
      )}

      {returnBooking && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ocean-950/60 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-labelledby="return-title" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setReturnBooking(null);
        }}>
          <section className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-muted">Rental return</p>
            <h2 id="return-title" className="mt-1 text-xl font-extrabold text-ocean-950">Confirm return</h2>
            <p className="mt-2 text-sm leading-6 text-muted">Has the equipment been returned in good condition? This marks the rental completed.</p>
            {actionError && <p className="mt-3 text-sm font-semibold text-red-700" role="alert">{actionError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setReturnBooking(null)} className="rounded-full border border-line px-4 py-2.5 text-sm font-bold text-ink hover:bg-[#f6f8f9]">Cancel</button>
              <button type="button" disabled={actionBusy === returnBooking.id} onClick={() => void confirmReturn()} className="rounded-full bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-60">
                {actionBusy === returnBooking.id ? "Saving…" : "Confirm return"}
              </button>
            </div>
          </section>
        </div>
      )}

      {reviewBooking && user && (
        <ReviewDialog
          booking={reviewBooking}
          user={user}
          onClose={() => setReviewBooking(null)}
          onComplete={() => {
            setReviewBooking(null);
            setReviewNotice("Review posted. Thanks for sharing your feedback.");
          }}
        />
      )}

      {handoverBooking && user && (
        <SafetyHandoverDialog
          booking={handoverBooking}
          user={user}
          onClose={() => setHandoverBooking(null)}
          onComplete={() => setHandoverBooking(null)}
        />
      )}
    </>
  );
}

function OwnerBookingCard({
  booking,
  busy,
  onAccept,
  onDecline,
  onMessage,
  onHandover,
  onReview,
  onReturn,
}: {
  booking: RecordWithId;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onMessage: () => void;
  onHandover: () => void;
  onReview: () => void;
  onReturn: () => void;
}) {
  const status = String(booking.status || "pending");
  const title = displayText(booking.equipmentTitle, "Equipment rental");
  const renter = displayText(booking.renterName, "Paddlme renter");
  const image = displayText(booking.equipmentImageUrl, "/kayaking.webp");
  return (
    <article className="overflow-hidden rounded-2xl border border-line bg-white">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
        <img src={image} alt="" loading="lazy" className="h-28 w-full rounded-xl bg-ocean-50 object-cover sm:h-24 sm:w-32" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="font-extrabold text-ocean-950">{title}</h3>
              <p className="mt-1 text-sm font-semibold text-ink">Renter: {renter}</p>
            </div>
            <span className={`rounded-full px-3 py-1 text-[11px] font-bold ${statusStyles[status] || statusStyles.closed}`}>
              {statusLabels[status] || status}
            </span>
          </div>
          <BookingDates booking={booking} />
          <p className="mt-2 text-xs font-semibold text-muted">Total · {formatPrice(booking.totalPrice)}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-line bg-[#fbfcfc] px-4 py-3">
        {status === "pending" && (
          <>
            <button type="button" disabled={busy} onClick={onAccept} className="rounded-full bg-ocean-950 px-4 py-2 text-xs font-bold text-white hover:bg-ocean-800 disabled:opacity-60">
              {busy ? "Working…" : "Accept request"}
            </button>
            <button type="button" disabled={busy} onClick={onDecline} className="rounded-full border border-red-200 bg-white px-4 py-2 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-60">Decline</button>
            <button type="button" disabled={busy} onClick={onMessage} className="rounded-full border border-line bg-white px-4 py-2 text-xs font-bold text-ink hover:bg-[#f6f8f9] disabled:opacity-60">Message renter</button>
          </>
        )}
        {status === "confirmed" && (
          <>
            <button type="button" onClick={onHandover} className="rounded-full bg-ocean-700 px-4 py-2 text-xs font-bold text-white hover:bg-ocean-800">Start safety handover</button>
            <button type="button" disabled={busy} onClick={onMessage} className="rounded-full border border-line bg-white px-4 py-2 text-xs font-bold text-ink hover:bg-[#f6f8f9] disabled:opacity-60">Message renter</button>
          </>
        )}
        {status === "active" && (
          <>
            <button type="button" onClick={onReturn} className="rounded-full bg-emerald-700 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-800">Mark as returned</button>
            <button type="button" disabled={busy} onClick={onMessage} className="rounded-full border border-line bg-white px-4 py-2 text-xs font-bold text-ink hover:bg-[#f6f8f9] disabled:opacity-60">Message renter</button>
          </>
        )}
        {status === "completed" && booking.ownerReviewed !== true && (
          <button type="button" onClick={onReview} className="rounded-full bg-ocean-950 px-4 py-2 text-xs font-bold text-white hover:bg-ocean-800">
            Review renter
          </button>
        )}
        {!["pending", "confirmed", "active"].includes(status) && (
          booking.ownerReviewed === true && status === "completed" ? (
            <span className="text-xs font-bold text-emerald-700">✓ Review submitted</span>
          ) : (
            <span className="text-xs font-semibold text-muted">
              {status === "completed" ? "This rental has been returned." : "No action needed."}
            </span>
          )
        )}
      </div>
    </article>
  );
}

function ReviewDialog({
  booking,
  user,
  onClose,
  onComplete,
}: {
  booking: RecordWithId;
  user: User;
  onClose: () => void;
  onComplete: () => void;
}) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submitReview(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rating) {
      setError("Please select a rating.");
      return;
    }
    if (!comment.trim()) {
      setError("Please write a review.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const [{ db }, firestore] = await Promise.all([
        import("../../lib/firebase"),
        import("firebase/firestore"),
      ]);
      const reviewRef = firestore.doc(firestore.collection(db, "reviews"));
      const batch = firestore.writeBatch(db);
      batch.set(reviewRef, {
        bookingId: booking.id,
        reviewerId: user.uid,
        reviewerName:
          user.displayName || user.email?.split("@")[0] || "Paddlme member",
        reviewedId: displayText(booking.renterId),
        reviewerType: "owner",
        rating,
        comment: comment.trim(),
        createdAt: firestore.serverTimestamp(),
      });
      const bookingUpdate: DocumentData = {
        ownerReviewed: true,
        ownerReviewId: reviewRef.id,
        updatedAt: firestore.serverTimestamp(),
      };
      if (booking.renterReviewed === true) {
        bookingUpdate.status = "closed";
        bookingUpdate.closedAt = firestore.serverTimestamp();
      }
      batch.update(firestore.doc(db, "bookings", booking.id), bookingUpdate);
      await batch.commit();
      onComplete();
    } catch (submitError) {
      console.error("Failed to submit renter review:", submitError);
      setError("We couldn't submit your review. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[55] grid place-items-center bg-ocean-950/60 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-labelledby="review-title" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl sm:p-8">
        <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-ocean-500">Rental complete</p>
        <h2 id="review-title" className="mt-1 text-xl font-extrabold text-ocean-950">Review {displayText(booking.renterName, "this renter")}</h2>
        <p className="mt-2 text-sm text-muted">{displayText(booking.equipmentTitle, "Equipment rental")}</p>
        <form onSubmit={submitReview}>
          <fieldset className="mt-6">
            <legend className="text-sm font-bold text-ink">How was your experience?</legend>
            <div className="mt-2 flex gap-1" role="radiogroup" aria-label="Rating">
              {[1, 2, 3, 4, 5].map((value) => (
                <button key={value} type="button" role="radio" aria-checked={rating === value} aria-label={`${value} star${value === 1 ? "" : "s"}`} onClick={() => setRating(value)} className={`rounded-lg px-1 text-3xl transition-transform hover:scale-110 ${value <= rating ? "text-accent" : "text-gray-300"}`}>
                  ★
                </button>
              ))}
            </div>
          </fieldset>
          <label htmlFor="renter-review-comment" className="mt-5 block text-sm font-bold text-ink">Write a review</label>
          <textarea id="renter-review-comment" value={comment} onChange={(event) => setComment(event.target.value)} required maxLength={1000} rows={4} placeholder="Share how the rental went…" className="auth-input mt-2 resize-y" />
          {error && <p className="mt-3 text-sm font-semibold text-red-700" role="alert">{error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" disabled={busy} onClick={onClose} className="rounded-full border border-line px-4 py-2.5 text-sm font-bold text-ink hover:bg-[#f6f8f9] disabled:opacity-50">Cancel</button>
            <button type="submit" disabled={busy} className="rounded-full bg-ocean-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-ocean-800 disabled:opacity-60">{busy ? "Posting…" : "Post review"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function RenterBookingCard({ booking }: { booking: RecordWithId }) {
  const status = String(booking.status || "pending");
  const title = displayText(booking.equipmentTitle, "Equipment rental");
  return (
    <article className="flex flex-col gap-4 rounded-2xl border border-line bg-white p-4 sm:flex-row sm:items-center">
      <img src={displayText(booking.equipmentImageUrl, "/kayaking.webp")} alt="" loading="lazy" className="h-24 w-full rounded-xl bg-ocean-50 object-cover sm:w-32" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="font-extrabold text-ocean-950">{title}</h3>
          <span className={`rounded-full px-3 py-1 text-[11px] font-bold ${statusStyles[status] || statusStyles.closed}`}>
            {statusLabels[status] || status}
          </span>
        </div>
        <BookingDates booking={booking} />
        <p className="mt-2 text-xs font-semibold text-muted">Host: {displayText(booking.ownerName, "Paddlme host")}</p>
      </div>
      <p className="shrink-0 text-sm font-extrabold text-ocean-950">{formatPrice(booking.totalPrice)}</p>
    </article>
  );
}

function SafetyHandoverDialog({
  booking,
  user,
  onClose,
  onComplete,
}: {
  booking: RecordWithId;
  user: User;
  onClose: () => void;
  onComplete: () => void;
}) {
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [handshakeCode, setHandshakeCode] = useState("");
  const [verified, setVerified] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [codeMessage, setCodeMessage] = useState("");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, saving]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [{ db }, firestore] = await Promise.all([
          import("../../lib/firebase"),
          import("firebase/firestore"),
        ]);
        let checklistSnapshot;
        const linkedId = displayText(booking.safetyChecklistId);
        if (linkedId) {
          checklistSnapshot = await firestore.getDoc(
            firestore.doc(db, "safety_checklists", linkedId),
          );
        } else {
          const existing = await firestore.getDocs(
            firestore.query(
              firestore.collection(db, "safety_checklists"),
              firestore.where("bookingId", "==", booking.id),
              firestore.where("ownerId", "==", user.uid),
              firestore.limit(1),
            ),
          );
          checklistSnapshot = existing.docs[0];
        }

        let id = "";
        let data: DocumentData | undefined;
        if (checklistSnapshot?.exists()) {
          id = checklistSnapshot.id;
          data = checklistSnapshot.data();
        }

        if (!data) {
          const checklistRef = firestore.doc(
            firestore.collection(db, "safety_checklists"),
          );
          id = checklistRef.id;
          data = {
            bookingId: booking.id,
            equipmentId: displayText(booking.equipmentId),
            ownerId: user.uid,
            renterId: displayText(booking.renterId),
            conditionPhotos: [],
            damageNotes: "",
            condition: "good",
            allIncludedGearProvided: false,
            emergencyProceduresExplained: false,
            equipmentUsageExplained: false,
            returnTimeExplained: false,
            localHazardsExplained: false,
            ownerConfirmsSafeCondition: false,
            renterConfirmsInspection: false,
            ownerSignature: "",
            renterSignature: "",
            ownerSignedAt: firestore.serverTimestamp(),
            renterSignedAt: firestore.serverTimestamp(),
            createdAt: firestore.serverTimestamp(),
            completedAt: null,
            status: "inProgress",
            updatedAt: firestore.serverTimestamp(),
          };
          await firestore.setDoc(checklistRef, data);
        }

        if (!cancelled) {
          setChecklist({
            id,
            bookingId: booking.id,
            equipmentId: displayText(data.equipmentId),
            ownerId: displayText(data.ownerId, user.uid),
            renterId: displayText(data.renterId, displayText(booking.renterId)),
            condition:
              data.condition === "excellent" ||
              data.condition === "fair" ||
              data.condition === "poor"
                ? data.condition
                : "good",
            damageNotes: displayText(data.damageNotes),
            allIncludedGearProvided: data.allIncludedGearProvided === true,
            emergencyProceduresExplained:
              data.emergencyProceduresExplained === true,
            equipmentUsageExplained: data.equipmentUsageExplained === true,
            returnTimeExplained: data.returnTimeExplained === true,
            localHazardsExplained: data.localHazardsExplained === true,
            ownerConfirmsSafeCondition: data.ownerConfirmsSafeCondition === true,
            renterConfirmsInspection: data.renterConfirmsInspection === true,
            status: displayText(data.status, "inProgress"),
          });
          if (booking.safetyChecklistId !== id) {
            await firestore.updateDoc(firestore.doc(db, "bookings", booking.id), {
              safetyChecklistId: id,
              handoverStatus: "in_progress",
              updatedAt: firestore.serverTimestamp(),
            });
          }
        }
      } catch (loadError) {
        console.error("Failed to initialize safety handover:", loadError);
        if (!cancelled) {
          setError("We couldn't start the safety handover. Please try again.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [booking, user]);

  function updateChecklist<K extends keyof Checklist>(key: K, value: Checklist[K]) {
    setChecklist((current) => (current ? { ...current, [key]: value } : current));
  }

  async function verifyCode() {
    const code = handshakeCode.trim().toUpperCase();
    if (code.length !== 6) {
      setCodeMessage("Enter the six-character code shown on the renter’s phone.");
      return;
    }
    setVerifying(true);
    setCodeMessage("");
    try {
      const [{ httpsCallable, getFunctions }] = await Promise.all([
        import("firebase/functions"),
      ]);
      const verify = httpsCallable<
        { bookingId: string; code: string },
        { status: string }
      >(getFunctions(), "verifyRentalHandshake");
      const response = await verify({ bookingId: booking.id, code });
      const accepted =
        response.data.status === "verified" ||
        response.data.status === "already_verified";
      setVerified(accepted);
      setCodeMessage(
        accepted
          ? "Handover code verified with the renter."
          : "That code doesn’t match. Check it with the renter.",
      );
    } catch (verifyError) {
      console.error("Failed to verify handover code:", verifyError);
      setCodeMessage(
        verifyError instanceof Error
          ? verifyError.message
          : "We couldn't verify the code. Please try again.",
      );
    } finally {
      setVerifying(false);
    }
  }

  async function reissueCode() {
    setVerifying(true);
    setCodeMessage("");
    try {
      const [{ httpsCallable, getFunctions }] = await Promise.all([
        import("firebase/functions"),
      ]);
      const reissue = httpsCallable<{ bookingId: string }, { status: string }>(
        getFunctions(),
        "reissueRentalHandshake",
      );
      await reissue({ bookingId: booking.id });
      setHandshakeCode("");
      setVerified(false);
      setCodeMessage("A new code has been issued. Ask the renter to refresh their app.");
    } catch (reissueError) {
      console.error("Failed to re-issue handover code:", reissueError);
      setCodeMessage(
        reissueError instanceof Error
          ? reissueError.message
          : "We couldn't re-issue the code. Please try again.",
      );
    } finally {
      setVerifying(false);
    }
  }

  const briefingComplete =
    Boolean(checklist?.allIncludedGearProvided) &&
    Boolean(checklist?.emergencyProceduresExplained) &&
    Boolean(checklist?.equipmentUsageExplained) &&
    Boolean(checklist?.returnTimeExplained) &&
    Boolean(checklist?.localHazardsExplained);
  const canSubmit = briefingComplete && Boolean(checklist?.renterConfirmsInspection) && verified;

  async function submitChecklist() {
    if (!checklist || !canSubmit) return;
    setSaving(true);
    setError("");
    try {
      const [{ db }, firestore] = await Promise.all([
        import("../../lib/firebase"),
        import("firebase/firestore"),
      ]);
      await firestore.updateDoc(
        firestore.doc(db, "safety_checklists", checklist.id),
        {
          condition: checklist.condition,
          damageNotes: checklist.damageNotes,
          allIncludedGearProvided: checklist.allIncludedGearProvided,
          emergencyProceduresExplained:
            checklist.emergencyProceduresExplained,
          equipmentUsageExplained: checklist.equipmentUsageExplained,
          returnTimeExplained: checklist.returnTimeExplained,
          localHazardsExplained: checklist.localHazardsExplained,
          ownerConfirmsSafeCondition: checklist.ownerConfirmsSafeCondition,
          renterConfirmsInspection: checklist.renterConfirmsInspection,
          status: "completed",
          ownerSignedAt: firestore.serverTimestamp(),
          renterSignedAt: firestore.serverTimestamp(),
          completedAt: firestore.serverTimestamp(),
          updatedAt: firestore.serverTimestamp(),
        },
      );
      await firestore.updateDoc(
        firestore.doc(db, "bookings", booking.id),
        {
          status: "active",
          handoverStatus: "completed",
          actualStartTime: firestore.serverTimestamp(),
          updatedAt: firestore.serverTimestamp(),
        },
      );
      onComplete();
    } catch (submitError) {
      console.error("Failed to submit safety handover:", submitError);
      setError(
        "We couldn't submit this handover. Check your connection and make sure the renter's code is verified.",
      );
    } finally {
      setSaving(false);
    }
  }

  const steps = ["Equipment condition", "Gear & briefing", "Confirmation", "Review"];
  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-ocean-950/65 p-3 backdrop-blur-sm sm:p-6" role="dialog" aria-modal="true" aria-labelledby="handover-title" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) onClose();
    }}>
      <div className="flex min-h-full items-center justify-center">
        <section className="w-full max-w-2xl overflow-hidden rounded-3xl bg-white shadow-2xl">
          <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-7">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-ocean-500">Confirmed rental</p>
              <h2 id="handover-title" className="mt-1 text-xl font-extrabold text-ocean-950">Safety handover</h2>
              <p className="mt-1 text-sm text-muted">{displayText(booking.equipmentTitle, "Equipment")} · {displayText(booking.renterName, "Renter")}</p>
            </div>
            <button type="button" disabled={saving} onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-xl text-muted hover:bg-[#f6f8f9] disabled:opacity-50" aria-label="Close safety handover">×</button>
          </header>

          <div className="px-5 pt-5 sm:px-7">
            <div className="mb-3 flex gap-1.5" aria-label={`Step ${step + 1} of 4`}>
              {steps.map((label, index) => (
                <div key={label} className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100" title={label}>
                  <div className={`h-full rounded-full transition-all ${index <= step ? "bg-ocean-600" : "bg-transparent"}`} />
                </div>
              ))}
            </div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted">Step {step + 1} of 4 · {steps[step]}</p>
          </div>

          <div className="max-h-[65vh] overflow-y-auto px-5 py-5 sm:px-7">
            {loading ? (
              <div className="py-12 text-center text-sm font-semibold text-muted" role="status">Preparing your safety checklist…</div>
            ) : error && !checklist ? (
              <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700" role="alert">{error}</p>
            ) : checklist ? (
              <>
                {step === 0 && (
                  <div>
                    <h3 className="text-lg font-extrabold text-ocean-950">Equipment condition</h3>
                    <p className="mt-1 text-sm leading-6 text-muted">Rate the gear as you hand it over, and note any visible damage.</p>
                    <fieldset className="mt-5">
                      <legend className="mb-2 text-sm font-bold text-ink">Current condition</legend>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {(["excellent", "good", "fair", "poor"] as const).map((condition) => (
                          <button key={condition} type="button" aria-pressed={checklist.condition === condition} onClick={() => updateChecklist("condition", condition)} className={`rounded-xl border px-3 py-3 text-sm font-bold capitalize transition-colors ${checklist.condition === condition ? "border-ocean-700 bg-ocean-50 text-ocean-950" : "border-line text-ink hover:bg-[#f6f8f9]"}`}>
                            {condition}
                          </button>
                        ))}
                      </div>
                    </fieldset>
                    <label htmlFor="handover-damage" className="mt-5 block text-sm font-bold text-ink">Damage notes <span className="font-medium text-muted">(optional)</span></label>
                    <textarea id="handover-damage" value={checklist.damageNotes} onChange={(event) => updateChecklist("damageNotes", event.target.value)} rows={4} maxLength={1000} placeholder="Note any damage, scratches or issues…" className="auth-input mt-2 resize-y" />
                  </div>
                )}

                {step === 1 && (
                  <div>
                    <h3 className="text-lg font-extrabold text-ocean-950">Gear & safety briefing</h3>
                    <p className="mt-1 text-sm leading-6 text-muted">Check the included gear and tick off each safety point as you go through it with the renter.</p>
                    <div className="mt-5 rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm leading-6 text-blue-900">
                      Confirm all gear listed in the equipment’s “What’s Included” section is present and will be provided.
                    </div>
                    <div className="mt-4 space-y-1">
                      <ChecklistCheckbox checked={checklist.allIncludedGearProvided} onChange={(checked) => updateChecklist("allIncludedGearProvided", checked)} title="All included gear is provided" detail="Every item listed is included with this rental." />
                      <p className="border-t border-line pt-4 text-sm font-extrabold text-ocean-950">Safety briefing you gave</p>
                      <ChecklistCheckbox checked={checklist.emergencyProceduresExplained} onChange={(checked) => updateChecklist("emergencyProceduresExplained", checked)} title="Emergency procedures" detail="What to do if they capsize, fall off or need help." />
                      <ChecklistCheckbox checked={checklist.equipmentUsageExplained} onChange={(checked) => updateChecklist("equipmentUsageExplained", checked)} title="Equipment use" detail="How to launch, use and secure the equipment." />
                      <ChecklistCheckbox checked={checklist.returnTimeExplained} onChange={(checked) => updateChecklist("returnTimeExplained", checked)} title="Return time and process" detail="When and where to return it, and what happens if they are late." />
                      <ChecklistCheckbox checked={checklist.localHazardsExplained} onChange={(checked) => updateChecklist("localHazardsExplained", checked)} title="Local hazards" detail="Currents, rocks, other craft and today's conditions." />
                    </div>
                  </div>
                )}

                {step === 2 && (
                  <div>
                    <h3 className="text-lg font-extrabold text-ocean-950">Confirmation</h3>
                    <p className="mt-1 text-sm leading-6 text-muted">Confirm the equipment is safe, and record the renter’s acknowledgement in person.</p>
                    <div className="mt-4 space-y-1">
                      <ChecklistCheckbox checked={checklist.ownerConfirmsSafeCondition} onChange={(checked) => updateChecklist("ownerConfirmsSafeCondition", checked)} title="Equipment is safe and as listed" detail="Its condition matches the listing and the gear is ready to rent." />
                      <ChecklistCheckbox checked={checklist.renterConfirmsInspection} onChange={(checked) => updateChecklist("renterConfirmsInspection", checked)} title="Renter confirms the gear matches the listing" detail="The renter has inspected the gear and heard the safety briefing." />
                    </div>
                    <div className="mt-5 rounded-2xl border border-ocean-100 bg-ocean-50/60 p-4">
                      <p className="text-sm font-extrabold text-ocean-950">Verify the renter’s handover code</p>
                      <p className="mt-1 text-xs leading-5 text-muted">Ask the renter to read the six-character code from their app. The code is verified securely and is never shown on your screen.</p>
                      {verified ? (
                        <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm font-bold text-emerald-800" role="status">✓ {codeMessage}</p>
                      ) : (
                        <>
                          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                            <input value={handshakeCode} onChange={(event) => setHandshakeCode(event.target.value.slice(0, 6).toUpperCase())} maxLength={6} autoComplete="off" aria-label="Renter’s six-character handover code" placeholder="6-character code" className="auth-input min-w-0 flex-1 font-bold tracking-[0.2em] uppercase" />
                            <button type="button" disabled={verifying} onClick={() => void verifyCode()} className="rounded-xl bg-ocean-950 px-5 py-3 text-sm font-bold text-white hover:bg-ocean-800 disabled:opacity-60">
                              {verifying ? "Verifying…" : "Verify code"}
                            </button>
                          </div>
                          {codeMessage && <p className="mt-2 text-sm font-semibold text-red-700" role="alert">{codeMessage}</p>}
                          <button type="button" disabled={verifying} onClick={() => void reissueCode()} className="mt-2 text-xs font-bold text-ocean-700 underline decoration-ocean-300 underline-offset-2 hover:text-ocean-950 disabled:opacity-60">
                            Renter can’t show their code
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {step === 3 && (
                  <div>
                    <h3 className="text-lg font-extrabold text-ocean-950">Review & submit</h3>
                    <p className="mt-1 text-sm leading-6 text-muted">Check the details before completing the handover. This will activate the rental.</p>
                    <dl className="mt-5 divide-y divide-line rounded-2xl border border-line px-4">
                      <ReviewRow label="Equipment" value={displayText(booking.equipmentTitle, "Equipment")} />
                      <ReviewRow label="Condition" value={checklist.condition} />
                      <ReviewRow label="Damage notes" value={checklist.damageNotes || "None noted"} />
                      <ReviewRow label="Included gear" value={checklist.allIncludedGearProvided ? "Confirmed" : "Not confirmed"} />
                      <ReviewRow label="Safety briefing" value={["emergencyProceduresExplained", "equipmentUsageExplained", "returnTimeExplained", "localHazardsExplained"].every((key) => checklist[key as keyof Checklist]) ? "All four points covered" : "Incomplete"} />
                      <ReviewRow label="Renter acknowledgement" value={checklist.renterConfirmsInspection ? "Confirmed" : "Not confirmed"} />
                      <ReviewRow label="Handover code" value={verified ? "Verified" : "Not verified"} />
                    </dl>
                    {!canSubmit && (
                      <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold leading-6 text-amber-900" role="status">
                        To submit, confirm the included gear, cover all four safety points, record the renter’s acknowledgement and verify their code.
                      </p>
                    )}
                    {error && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700" role="alert">{error}</p>}
                  </div>
                )}
              </>
            ) : null}
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4 sm:px-7">
            <button type="button" disabled={loading || saving || step === 0} onClick={() => setStep((current) => Math.max(0, current - 1))} className="rounded-full border border-line px-5 py-2.5 text-sm font-bold text-ink hover:bg-[#f6f8f9] disabled:cursor-not-allowed disabled:opacity-40">
              Back
            </button>
            {step < 3 ? (
              <button type="button" disabled={loading || !checklist} onClick={() => setStep((current) => Math.min(3, current + 1))} className="rounded-full bg-ocean-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-ocean-800 disabled:opacity-50">
                Continue
              </button>
            ) : (
              <button type="button" disabled={!canSubmit || saving} onClick={() => void submitChecklist()} className="rounded-full bg-ocean-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-ocean-800 disabled:cursor-not-allowed disabled:opacity-50">
                {saving ? "Submitting…" : "Submit safety handover"}
              </button>
            )}
          </footer>
        </section>
      </div>
    </div>
  );
}

function ChecklistCheckbox({
  checked,
  onChange,
  title,
  detail,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  detail: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-[#f8f9fa]">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-1 h-4 w-4 accent-ocean-700" />
      <span>
        <span className="block text-sm font-bold text-ocean-950">{title}</span>
        <span className="mt-0.5 block text-xs leading-5 text-muted">{detail}</span>
      </span>
    </label>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-2 py-3 text-sm">
      <dt className="font-semibold text-muted">{label}</dt>
      <dd className="font-bold capitalize text-ocean-950">{value}</dd>
    </div>
  );
}
