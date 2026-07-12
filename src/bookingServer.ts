import type { BlockedSlot, Booking, BookingDraft, BookingStatus } from './types';

export type BookingSnapshot = { bookings: Booking[]; blockedSlots: BlockedSlot[] };
export type BookingRepository = { read(): BookingSnapshot; write(snapshot: BookingSnapshot): void };

export class BookingServerError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'BookingServerError';
    this.status = status;
    this.code = code;
  }
}

export const isSlotOccupied = (snapshot: BookingSnapshot, specialistId: string, date: string, time: string, excludedBookingId?: string) =>
  snapshot.bookings.some((booking) => booking.id !== excludedBookingId && booking.specialistId === specialistId && booking.date === date && booking.time === time && booking.status !== 'cancelled') ||
  snapshot.blockedSlots.some((slot) => slot.specialistId === specialistId && slot.date === date && slot.time === time);

const conflict = () => new BookingServerError('Этот слот уже занят. Выберите другое время.', 409, 'SLOT_CONFLICT');

export class BookingServer {
  private mutationQueue: Promise<void> = Promise.resolve();
  private readonly repository: BookingRepository;

  constructor(repository: BookingRepository) { this.repository = repository; }
  getSnapshot() { return this.repository.read(); }
  getAvailability(specialistId: string, date: string, times: string[]) {
    const snapshot = this.repository.read();
    return times.map((time) => ({ time, available: !isSlotOccupied(snapshot, specialistId, date, time) }));
  }

  private async mutate<T>(operation: () => T): Promise<T> {
    let release: () => void = () => {};
    const previous = this.mutationQueue;
    this.mutationQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return operation(); } finally { release(); }
  }

  createBooking(draft: BookingDraft, idempotencyKey: string) {
    return this.mutate(() => {
      const snapshot = this.repository.read();
      const replay = snapshot.bookings.find((booking) => booking.idempotencyKey === idempotencyKey);
      if (replay) return replay;
      if (isSlotOccupied(snapshot, draft.specialistId, draft.date, draft.time)) throw conflict();
      const booking: Booking = { ...draft, id: `booking-${crypto.randomUUID()}`, idempotencyKey, status: 'confirmed', createdAt: new Date().toISOString() };
      this.repository.write({ ...snapshot, bookings: [booking, ...snapshot.bookings] });
      return booking;
    });
  }

  cancelBooking(id: string) {
    return this.mutate(() => {
      const snapshot = this.repository.read();
      if (!snapshot.bookings.some((booking) => booking.id === id)) {
        throw new BookingServerError('Запись не найдена.', 404, 'BOOKING_NOT_FOUND');
      }
      const bookings = snapshot.bookings.map((booking) => booking.id === id ? { ...booking, status: 'cancelled' as const } : booking);
      this.repository.write({ ...snapshot, bookings });
      return bookings;
    });
  }

  rescheduleBooking(id: string, date: string, time: string) {
    return this.mutate(() => {
      const snapshot = this.repository.read();
      const current = snapshot.bookings.find((booking) => booking.id === id);
      if (!current) throw new BookingServerError('Запись не найдена.', 404, 'BOOKING_NOT_FOUND');
      if (isSlotOccupied(snapshot, current.specialistId, date, time, id)) throw conflict();
      const bookings = snapshot.bookings.map((booking) => booking.id === id ? { ...booking, date, time, status: 'confirmed' as const } : booking);
      this.repository.write({ ...snapshot, bookings });
      return bookings;
    });
  }

  updateBookingStatus(id: string, status: BookingStatus) {
    return this.mutate(() => {
      const snapshot = this.repository.read();
      if (!snapshot.bookings.some((booking) => booking.id === id)) {
        throw new BookingServerError('Запись не найдена.', 404, 'BOOKING_NOT_FOUND');
      }
      const bookings = snapshot.bookings.map((booking) => booking.id === id ? { ...booking, status } : booking);
      this.repository.write({ ...snapshot, bookings });
      return bookings;
    });
  }

  blockSlot(slot: Omit<BlockedSlot, 'id'>) {
    return this.mutate(() => {
      const snapshot = this.repository.read();
      if (isSlotOccupied(snapshot, slot.specialistId, slot.date, slot.time)) throw new BookingServerError('Нельзя заблокировать уже занятую записью ячейку.', 409, 'SLOT_CONFLICT');
      const blockedSlots = [{ ...slot, id: `blocked-${crypto.randomUUID()}` }, ...snapshot.blockedSlots];
      this.repository.write({ ...snapshot, blockedSlots });
      return blockedSlots;
    });
  }

  unblockSlot(id: string) {
    return this.mutate(() => {
      const snapshot = this.repository.read();
      const blockedSlots = snapshot.blockedSlots.filter((slot) => slot.id !== id);
      this.repository.write({ ...snapshot, blockedSlots });
      return blockedSlots;
    });
  }
}
