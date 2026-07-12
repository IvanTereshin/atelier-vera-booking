import assert from 'node:assert/strict';
import test from 'node:test';
import { BookingServer, BookingServerError, isSlotOccupied } from '../src/bookingServer.ts';

const draft = (time = '10:00') => ({
  serviceId: 'haircut-style', specialistId: 'anna', date: '2030-01-10', time,
  clientName: 'Тестовый клиент', clientPhone: '+7 900 000-00-00',
});

const makeServer = (bookings = [], blockedSlots = []) => {
  let state = { bookings: structuredClone(bookings), blockedSlots: structuredClone(blockedSlots) };
  const server = new BookingServer({
    read: () => structuredClone(state),
    write: (next) => { state = structuredClone(next); },
  });
  return { server, state: () => structuredClone(state) };
};

test('parallel create is atomic: one success and one 409 conflict', async () => {
  const { server, state } = makeServer();
  const results = await Promise.allSettled([
    server.createBooking(draft(), 'request-a'),
    server.createBooking(draft(), 'request-b'),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result) => result.status === 'rejected');
  assert.ok(rejected?.reason instanceof BookingServerError);
  assert.equal(rejected.reason.status, 409);
  assert.equal(rejected.reason.code, 'SLOT_CONFLICT');
  assert.equal(state().bookings.length, 1);
});

test('same idempotency key replays result without a duplicate', async () => {
  const { server, state } = makeServer();
  const first = await server.createBooking(draft(), 'stable-request');
  const retry = await server.createBooking(draft(), 'stable-request');
  assert.equal(retry.id, first.id);
  assert.equal(state().bookings.length, 1);
});

test('cancel releases the slot for a new booking', async () => {
  const { server, state } = makeServer();
  const first = await server.createBooking(draft(), 'first');
  await server.cancelBooking(first.id);
  assert.equal(isSlotOccupied(state(), 'anna', '2030-01-10', '10:00'), false);
  assert.deepEqual(server.getAvailability('anna', '2030-01-10', ['10:00']), [{ time: '10:00', available: true }]);
  await server.createBooking(draft(), 'replacement');
  assert.equal(state().bookings.length, 2);
});

test('conflicting reschedule preserves the original booking', async () => {
  const original = { ...draft('10:00'), id: 'original', status: 'confirmed', createdAt: '2030-01-01T00:00:00.000Z' };
  const occupied = { ...draft('11:15'), id: 'occupied', status: 'confirmed', createdAt: '2030-01-01T00:00:00.000Z' };
  const { server, state } = makeServer([original, occupied]);
  await assert.rejects(() => server.rescheduleBooking('original', '2030-01-10', '11:15'), (error) => error.status === 409);
  const preserved = state().bookings.find((booking) => booking.id === 'original');
  assert.equal(preserved.date, '2030-01-10');
  assert.equal(preserved.time, '10:00');
});

test('cancel and status update reject unknown booking ids', async () => {
  const { server, state } = makeServer();
  const isNotFound = (error) => error instanceof BookingServerError && error.status === 404 && error.code === 'BOOKING_NOT_FOUND';
  await assert.rejects(() => server.cancelBooking('missing'), isNotFound);
  await assert.rejects(() => server.updateBookingStatus('missing', 'completed'), isNotFound);
  assert.deepEqual(state(), { bookings: [], blockedSlots: [] });
});
