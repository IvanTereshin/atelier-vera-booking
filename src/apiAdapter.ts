import { services, specialists } from './data';
import { BookingServer, BookingServerError } from './bookingServer';
import { bookingStore } from './storage';
import type { BlockedSlot, BookingDraft, BookingStatus } from './types';

const wait = (ms = 320) => new Promise((resolve) => window.setTimeout(resolve, ms));
const server = new BookingServer({
  read: () => ({ bookings: bookingStore.getBookings(), blockedSlots: bookingStore.getBlockedSlots() }),
  write: ({ bookings, blockedSlots }) => { bookingStore.setBookings(bookings); bookingStore.setBlockedSlots(blockedSlots); },
});

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 500, code = 'API_ERROR') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

const request = async <T>(operation: () => Promise<T> | T): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof BookingServerError) throw new ApiError(error.message, error.status, error.code);
    throw new ApiError('Сервис записи временно недоступен. Повторите запрос.');
  }
};

export const api = {
  async bootstrap() { await wait(450); return { services, specialists, ...server.getSnapshot() }; },
  async createBooking(draft: BookingDraft, idempotencyKey: string) { await wait(520); return request(() => server.createBooking(draft, idempotencyKey)); },
  async getAvailability(specialistId: string, date: string, times: string[]) { await wait(120); return request(() => server.getAvailability(specialistId, date, times)); },
  async cancelBooking(id: string) { await wait(); return server.cancelBooking(id); },
  async rescheduleBooking(id: string, date: string, time: string) { await wait(); return server.rescheduleBooking(id, date, time); },
  async updateBookingStatus(id: string, status: BookingStatus) { await wait(); return server.updateBookingStatus(id, status); },
  async blockSlot(slot: Omit<BlockedSlot, 'id'>) { await wait(); return server.blockSlot(slot); },
  async unblockSlot(id: string) { await wait(); return server.unblockSlot(id); },
};
