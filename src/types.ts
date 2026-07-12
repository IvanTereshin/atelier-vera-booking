export type Service = {
  id: string;
  title: string;
  description: string;
  price: number;
  durationMin: number;
  category: string;
};

export type Specialist = {
  id: string;
  name: string;
  role: string;
  rating: number;
  reviewCount: number;
  image: string;
  serviceIds: string[];
  slots: string[];
  initials: string;
  accent: string;
};

export type BookingStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled';

export type Booking = {
  id: string;
  serviceId: string;
  specialistId: string;
  date: string;
  time: string;
  clientName: string;
  clientPhone: string;
  note?: string;
  status: BookingStatus;
  createdAt: string;
  idempotencyKey?: string;
};

export type BlockedSlot = {
  id: string;
  specialistId: string;
  date: string;
  time: string;
  reason: string;
};

export type BookingDraft = {
  serviceId: string;
  specialistId: string;
  date: string;
  time: string;
  clientName: string;
  clientPhone: string;
  note?: string;
};

export type TabKey = 'booking' | 'my' | 'admin' | 'settings';
