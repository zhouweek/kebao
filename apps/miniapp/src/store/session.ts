import Taro from "@tarojs/taro";
import type { Booking } from "../api/types";

export type Identity =
  | { role: "parent"; id: string; name: string }
  | { role: "teacher"; id: string; name: string };

export interface SavedBooking {
  booking: Booking;
  courseName: string;
  startsAt: string;
  endsAt: string;
  cancelDeadlineAt: string;
  campusName: string;
  classroomName: string | null;
}

export interface AuthState {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
}

const IDENTITY_KEY = "kebao.identity";
const BOOKINGS_KEY = "kebao.bookings";
const AUTH_KEY = "kebao.auth";

export function saveIdentity(identity: Identity): void {
  Taro.setStorageSync(IDENTITY_KEY, identity);
}

export function getIdentity(): Identity | undefined {
  return Taro.getStorageSync<Identity>(IDENTITY_KEY) || undefined;
}

export function saveAuth(auth: AuthState): void {
  Taro.setStorageSync(AUTH_KEY, auth);
}

export function getAuth(): AuthState | undefined {
  return Taro.getStorageSync<AuthState>(AUTH_KEY) || undefined;
}

export function clearAuth(): void {
  Taro.removeStorageSync(AUTH_KEY);
}

export function getSavedBookings(): SavedBooking[] {
  return Taro.getStorageSync<SavedBooking[]>(BOOKINGS_KEY) || [];
}

export function saveBooking(item: SavedBooking): void {
  const bookings = getSavedBookings().filter(
    (saved) => saved.booking.id !== item.booking.id,
  );
  Taro.setStorageSync(BOOKINGS_KEY, [item, ...bookings]);
}

export function markBookingCancelled(bookingId: string): void {
  const bookings = getSavedBookings().map((item) =>
    item.booking.id === bookingId
      ? { ...item, booking: { ...item.booking, status: "CANCELLED" as const } }
      : item,
  );
  Taro.setStorageSync(BOOKINGS_KEY, bookings);
}
