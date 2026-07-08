import { services, specialists } from './data';
import { bookingStore } from './storage';
import type { BlockedSlot, Booking, BookingDraft, BookingStatus } from './types';

const wait = (ms = 320) => new Promise((resolve) => window.setTimeout(resolve, ms));

export type BookingSnapshot = {
  bookings: Booking[];
  blockedSlots: BlockedSlot[];
};

export const isSlotOccupied = (
  snapshot: BookingSnapshot,
  specialistId: string,
  date: string,
  time: string,
) => {
  const hasBooking = snapshot.bookings.some(
    (booking) =>
      booking.specialistId === specialistId &&
      booking.date === date &&
      booking.time === time &&
      booking.status !== 'cancelled',
  );
  const isBlocked = snapshot.blockedSlots.some(
    (slot) => slot.specialistId === specialistId && slot.date === date && slot.time === time,
  );

  return hasBooking || isBlocked;
};

export const api = {
  async bootstrap() {
    await wait(450);
    return {
      services,
      specialists,
      bookings: bookingStore.getBookings(),
      blockedSlots: bookingStore.getBlockedSlots(),
    };
  },

  async createBooking(draft: BookingDraft) {
    await wait(520);
    const bookings = bookingStore.getBookings();
    const blockedSlots = bookingStore.getBlockedSlots();
    const snapshot = { bookings, blockedSlots };

    if (isSlotOccupied(snapshot, draft.specialistId, draft.date, draft.time)) {
      throw new Error('Этот слот уже занят. Выберите другое время.');
    }

    const booking: Booking = {
      ...draft,
      id: `booking-${Date.now()}`,
      status: 'confirmed',
      createdAt: new Date().toISOString(),
    };

    const nextBookings = [booking, ...bookings];
    bookingStore.setBookings(nextBookings);
    return booking;
  },

  async cancelBooking(id: string) {
    await wait();
    const nextBookings = bookingStore
      .getBookings()
      .map((booking) => (booking.id === id ? { ...booking, status: 'cancelled' as const } : booking));
    bookingStore.setBookings(nextBookings);
    return nextBookings;
  },

  async rescheduleBooking(id: string, date: string, time: string) {
    await wait();
    const bookings = bookingStore.getBookings();
    const blockedSlots = bookingStore.getBlockedSlots();
    const currentBooking = bookings.find((booking) => booking.id === id);

    if (!currentBooking) {
      throw new Error('Запись не найдена.');
    }

    const hasBooking = bookings.some(
      (booking) =>
        booking.id !== id &&
        booking.specialistId === currentBooking.specialistId &&
        booking.date === date &&
        booking.time === time &&
        booking.status !== 'cancelled',
    );
    const hasBlock = blockedSlots.some(
      (slot) => slot.specialistId === currentBooking.specialistId && slot.date === date && slot.time === time,
    );

    if (hasBooking || hasBlock) {
      throw new Error('Этот слот уже занят. Выберите другое время.');
    }

    const nextBookings = bookings.map((booking) =>
      booking.id === id ? { ...booking, date, time, status: 'confirmed' as const } : booking,
    );
    bookingStore.setBookings(nextBookings);
    return nextBookings;
  },

  async updateBookingStatus(id: string, status: BookingStatus) {
    await wait();
    const nextBookings = bookingStore
      .getBookings()
      .map((booking) => (booking.id === id ? { ...booking, status } : booking));
    bookingStore.setBookings(nextBookings);
    return nextBookings;
  },

  async blockSlot(slot: Omit<BlockedSlot, 'id'>) {
    await wait();
    const bookings = bookingStore.getBookings();
    const blockedSlots = bookingStore.getBlockedSlots();
    const snapshot = { bookings, blockedSlots };

    if (isSlotOccupied(snapshot, slot.specialistId, slot.date, slot.time)) {
      throw new Error('Нельзя заблокировать уже занятую записью ячейку.');
    }

    const nextBlocked = [{ ...slot, id: `blocked-${Date.now()}` }, ...blockedSlots];
    bookingStore.setBlockedSlots(nextBlocked);
    return nextBlocked;
  },

  async unblockSlot(id: string) {
    await wait();
    const nextBlocked = bookingStore.getBlockedSlots().filter((slot) => slot.id !== id);
    bookingStore.setBlockedSlots(nextBlocked);
    return nextBlocked;
  },
};
