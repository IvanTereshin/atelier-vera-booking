import {
  Ban,
  Bell,
  CalendarDays,
  Check,
  Clock,
  CreditCard,
  Home,
  Landmark,
  LayoutDashboard,
  Loader2,
  MapPin,
  MessageCircle,
  Phone,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sparkles,
  Star,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { demoDates } from './data';
import { api, ApiError } from './apiAdapter';
import { initTelegramShell } from './telegram';
import type { BlockedSlot, Booking, BookingStatus, Service, Specialist, TabKey } from './types';

const currentClient = {
  name: 'Иван Терешин',
  phone: '+7 900 120-44-18',
};

type PaymentMethod = 'telegram-stars' | 'sbp' | 'yookassa';
type PaymentMode = 'test' | 'production';
type PaymentStatus = 'idle' | 'invoice' | 'paid';

type AppSettings = {
  paymentMode: PaymentMode;
  defaultPaymentMethod: PaymentMethod;
  reminders: 'both' | 'day' | 'two-hours';
  telegramReceipts: boolean;
  merchantLabel: string;
};

type PaymentSession = {
  id: string;
  method: PaymentMethod;
  endpoint: string;
  confirmationLabel: string;
};

const businessProfile = {
  name: 'Atelier Vera',
  subtitle: 'Hair, color and evening styling',
  address: 'Патриаршие, Большой Козихинский пер., 14',
  nearestSlot: 'сегодня 17:00',
  rating: '4.92',
  reviews: 318,
  cancellation: 'Бесплатный перенос за 6 часов',
};

const SETTINGS_KEY = 'local-booking-tma:settings-v2';

const defaultSettings: AppSettings = {
  paymentMode: 'test',
  defaultPaymentMethod: 'yookassa',
  reminders: 'both',
  telegramReceipts: true,
  merchantLabel: 'Atelier Vera · ShopID demo-1024',
};

const paymentMethods: Array<{
  id: PaymentMethod;
  title: string;
  short: string;
  details: string;
  endpoint: string;
}> = [
  {
    id: 'telegram-stars',
    title: 'Telegram Stars',
    short: 'XTR',
    details: 'Для цифрового депозита, сертификата или подписки внутри Telegram.',
    endpoint: '/api/payments/telegram-stars/invoice',
  },
  {
    id: 'sbp',
    title: 'СБП',
    short: 'QR / банк',
    details: 'Redirect-сценарий ЮKassa: клиент подтверждает оплату в приложении банка.',
    endpoint: '/api/payments/yookassa/sbp',
  },
  {
    id: 'yookassa',
    title: 'ЮKassa',
    short: 'Карта / SberPay',
    details: 'Платежная форма ЮKassa для услуг салона, чеков и возвратов.',
    endpoint: '/api/payments/yookassa/checkout',
  },
];

const moneyFormatter = new Intl.NumberFormat('ru-RU');

const statusCopy: Record<BookingStatus, { label: string; tone: string }> = {
  pending: { label: 'Ожидает', tone: 'warning' },
  confirmed: { label: 'Подтверждена', tone: 'success' },
  completed: { label: 'Завершена', tone: 'neutral' },
  cancelled: { label: 'Отменена', tone: 'danger' },
};

const formatMoney = (value: number) => `${moneyFormatter.format(value)} ₽`;

const formatDate = (date: string, mode: 'short' | 'long' = 'short') =>
  new Intl.DateTimeFormat('ru-RU', {
    weekday: mode === 'short' ? 'short' : 'long',
    day: 'numeric',
    month: mode === 'short' ? 'short' : 'long',
  }).format(new Date(`${date}T12:00:00`));

const isPastBooking = (booking: Booking) => {
  const bookingDate = new Date(`${booking.date}T${booking.time}:00`);
  return bookingDate.getTime() < Date.now() || booking.status === 'completed' || booking.status === 'cancelled';
};

const getService = (services: Service[], id: string) => services.find((service) => service.id === id);
const getSpecialist = (specialists: Specialist[], id: string) =>
  specialists.find((specialist) => specialist.id === id);
const getPaymentMethod = (id: PaymentMethod) => paymentMethods.find((method) => method.id === id) ?? paymentMethods[0];
const getPrepayAmount = (service: Service) => Math.max(300, Math.round(service.price * 0.2));

const readSettings = () => {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...defaultSettings, ...(JSON.parse(raw) as Partial<AppSettings>) } : defaultSettings;
  } catch {
    return defaultSettings;
  }
};

const writeSettings = (settings: AppSettings) => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
};

const createPaymentSession = async (
  method: PaymentMethod,
  amount: number,
  mode: PaymentMode,
): Promise<PaymentSession> => {
  await new Promise((resolve) => window.setTimeout(resolve, 420));
  const paymentMethod = getPaymentMethod(method);
  return {
    id: `${mode}-${method}-${Date.now()}-${amount}`,
    method,
    endpoint: paymentMethod.endpoint,
    confirmationLabel:
      method === 'telegram-stars'
        ? 'Открыть invoice в Telegram'
        : method === 'sbp'
          ? 'Открыть банк или QR'
          : 'Открыть форму ЮKassa',
  };
};

function useReducedMotionPreference() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return reduced;
}

function ImageFallback({
  src,
  alt,
  initials,
  gradient,
  className,
}: {
  src: string;
  alt: string;
  initials: string;
  gradient: string;
  className: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className={`${className} image-fallback`} style={{ background: gradient }} aria-label={alt}>
        {initials}
      </div>
    );
  }

  return <img className={className} src={src} alt={alt} onError={() => setFailed(true)} />;
}

function AppHeader({
  activeTab,
  onTabChange,
}: {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
}) {
  const title =
    activeTab === 'booking'
      ? businessProfile.name
      : activeTab === 'my'
        ? 'Мои записи'
        : activeTab === 'admin'
          ? 'Админ-день'
          : 'Настройки';

  return (
    <header className="app-header">
      <div>
        <p className="app-kicker">Private booking</p>
        <h1>{title}</h1>
      </div>
      <button className="telegram-action" type="button" onClick={() => onTabChange('my')}>
        <MessageCircle size={18} />
        <span>Telegram</span>
      </button>
    </header>
  );
}

function StudioIntro() {
  return (
    <section className="studio-intro">
      <ImageFallback
        src="/assets/booking-studio.png"
        alt="Светлый интерьер студии Atelier Vera"
        initials="AV"
        gradient="linear-gradient(135deg, #eadfd2, #cbb9aa 55%, #9a6250)"
        className="studio-image"
      />
      <div className="studio-monogram" aria-hidden="true">AV</div>
      <div className="studio-copy">
        <p className="studio-label">Private beauty studio · Moscow</p>
        <strong>{businessProfile.name}</strong>
        <small>{businessProfile.subtitle}</small>
        <div className="studio-next-slot">
          <span>Ближайшее окно</span>
          <b>{businessProfile.nearestSlot}</b>
        </div>
        <div className="studio-facts">
          <small>
            <MapPin size={13} /> {businessProfile.address}
          </small>
          <small>
            <Star size={13} fill="currentColor" /> {businessProfile.rating} · {businessProfile.reviews} отзывов
          </small>
          <small>
            <Users size={13} /> 3 мастера · приватные окна
          </small>
        </div>
      </div>
    </section>
  );
}

function BookingTimeline({ currentStep }: { currentStep: number }) {
  const steps = ['Услуга', 'Мастер', 'Дата', 'Время', 'Готово'];

  return (
    <section className="booking-timeline" aria-label="Шаги записи">
      {steps.map((step, index) => (
        <div className={index <= currentStep ? 'timeline-step active' : 'timeline-step'} key={step}>
          <span>{index < currentStep ? <Check size={12} /> : index + 1}</span>
          <strong>{step}</strong>
        </div>
      ))}
    </section>
  );
}

function BookingFlow({
  services,
  specialists,
  bookings,
  blockedSlots,
  settings,
  onCreated,
  onOpenBookings,
}: {
  services: Service[];
  specialists: Specialist[];
  bookings: Booking[];
  blockedSlots: BlockedSlot[];
  settings: AppSettings;
  onCreated: (booking: Booking) => void;
  onOpenBookings: () => void;
}) {
  const [serviceId, setServiceId] = useState(services[0]?.id ?? '');
  const [specialistId, setSpecialistId] = useState('');
  const [date, setDate] = useState(demoDates[0]);
  const [time, setTime] = useState('');
  const [note, setNote] = useState('');
  const [phoneCodeSent, setPhoneCodeSent] = useState(false);
  const [waitlistEntries, setWaitlistEntries] = useState<string[]>([]);
  const [waitlistNotice, setWaitlistNotice] = useState('');
  const [conflictSlot, setConflictSlot] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<Booking | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(settings.defaultPaymentMethod);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('idle');
  const [paymentSession, setPaymentSession] = useState<PaymentSession | null>(null);
  const [isCreatingPayment, setIsCreatingPayment] = useState(false);
  const [availableTimes, setAvailableTimes] = useState<string[]>([]);
  const [isAvailabilityLoading, setIsAvailabilityLoading] = useState(true);
  const [availabilityError, setAvailabilityError] = useState('');
  const [availabilityRetry, setAvailabilityRetry] = useState(0);
  const successRef = useRef<HTMLElement>(null);
  const idempotencyKeyRef = useRef(crypto.randomUUID());
  const reducedMotion = useReducedMotionPreference();

  const selectedService = getService(services, serviceId);
  const availableSpecialists = useMemo(
    () => specialists.filter((specialist) => specialist.serviceIds.includes(serviceId)),
    [serviceId, specialists],
  );
  const selectedSpecialist = getSpecialist(specialists, specialistId) ?? availableSpecialists[0];

  useEffect(() => {
    if (!serviceId && services[0]) {
      setServiceId(services[0].id);
    }
  }, [serviceId, services]);

  useEffect(() => {
    if (!selectedSpecialist && availableSpecialists[0]) {
      setSpecialistId(availableSpecialists[0].id);
      return;
    }

    if (selectedSpecialist && !selectedSpecialist.serviceIds.includes(serviceId)) {
      setSpecialistId(availableSpecialists[0]?.id ?? '');
      setTime('');
    }
  }, [availableSpecialists, selectedSpecialist, serviceId]);

  const confirmationTime = success?.time ?? time;
  const currentStep = success ? 4 : time ? 3 : date ? 2 : selectedSpecialist ? 1 : 0;
  const prepayAmount = selectedService ? getPrepayAmount(selectedService) : 0;

  useEffect(() => {
    setPaymentMethod(settings.defaultPaymentMethod);
    setPaymentStatus('idle');
    setPaymentSession(null);
  }, [settings.defaultPaymentMethod]);

  useEffect(() => {
    let active = true;
    setIsAvailabilityLoading(true);
    setAvailabilityError('');
    setAvailableTimes([]);
    api.getAvailability(selectedSpecialist.id, date, selectedSpecialist.slots)
      .then((availability) => {
        if (active) setAvailableTimes(availability.filter((slot) => slot.available).map((slot) => slot.time));
      })
      .catch((caught) => {
        if (active) setAvailabilityError(caught instanceof Error ? caught.message : 'Не удалось загрузить свободное время.');
      })
      .finally(() => {
        if (active) setIsAvailabilityLoading(false);
      });
    return () => { active = false; };
  }, [selectedSpecialist.id, selectedSpecialist.slots, date, bookings, blockedSlots, availabilityRetry]);

  useGSAP(
    () => {
      if (reducedMotion || !successRef.current) return;
      gsap.fromTo(
        successRef.current,
        { autoAlpha: 0, y: 18, scale: 0.98 },
        { autoAlpha: 1, y: 0, scale: 1, duration: 0.42, ease: 'power3.out' },
      );
    },
    { dependencies: [success?.id, reducedMotion] },
  );

  const handleServiceSelect = (id: string) => {
    idempotencyKeyRef.current = crypto.randomUUID();
    setServiceId(id);
    setTime('');
    setSuccess(null);
    setError('');
    setPaymentStatus('idle');
    setPaymentSession(null);
  };

  const handleSpecialistSelect = (id: string) => {
    idempotencyKeyRef.current = crypto.randomUUID();
    setSpecialistId(id);
    setTime('');
    setSuccess(null);
    setError('');
    setPaymentStatus('idle');
    setPaymentSession(null);
  };

  const handleCreate = async () => {
    if (!selectedService || !selectedSpecialist || !time || paymentStatus !== 'paid') return;

    setIsSaving(true);
    setError('');
    try {
      const booking = await api.createBooking({
        serviceId: selectedService.id,
        specialistId: selectedSpecialist.id,
        date,
        time,
        clientName: currentClient.name,
        clientPhone: currentClient.phone,
        note: note.trim() || undefined,
      }, idempotencyKeyRef.current);
      setSuccess(booking);
      setConflictSlot('');
      setTime('');
      setNote('');
      idempotencyKeyRef.current = crypto.randomUUID();
      onCreated(booking);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409 && caught.code === 'SLOT_CONFLICT') {
        setConflictSlot(time);
        setAvailableTimes((current) => current.filter((slot) => slot !== time));
      }
      setError(caught instanceof Error ? caught.message : 'Не удалось создать запись.');
    } finally {
      setIsSaving(false);
    }
  };

  const joinWaitlist = (slot: string) => {
    const key = `${selectedSpecialist.id}-${date}-${slot}`;
    setWaitlistEntries((current) => (current.includes(key) ? current : [...current, key]));
    setWaitlistNotice(`${slot} занят. Мы поставили вас в лист ожидания и пришлем уведомление, если окно освободится.`);
    setTime('');
    setSuccess(null);
    setPaymentStatus('idle');
    setPaymentSession(null);
  };

  const handlePaymentAction = async () => {
    if (!selectedService || !time) return;

    if (paymentStatus === 'invoice') {
      setPaymentStatus('paid');
      return;
    }

    setIsCreatingPayment(true);
    setError('');
    try {
      const session = await createPaymentSession(paymentMethod, prepayAmount, settings.paymentMode);
      setPaymentSession(session);
      setPaymentStatus('invoice');
    } catch {
      setError('Не удалось создать платежную сессию.');
    } finally {
      setIsCreatingPayment(false);
    }
  };

  const changePaymentMethod = (method: PaymentMethod) => {
    setPaymentMethod(method);
    setPaymentStatus('idle');
    setPaymentSession(null);
  };

  if (!selectedService || !selectedSpecialist) {
    return <EmptyState title="Нет доступных услуг" text="Добавьте услуги и специалистов в демо-данные." />;
  }

  return (
    <main className="screen booking-screen">
      <StudioIntro />
      <BookingTimeline currentStep={currentStep} />

      <section className="flow-section">
        <SectionTitle eyebrow="01 · Меню" title="Ритуал для вас" />
        <div className="service-list">
          {services.map((service) => (
            <button
              className={`service-row ${service.id === serviceId ? 'selected' : ''}`}
              type="button"
              key={service.id}
              onClick={() => handleServiceSelect(service.id)}
            >
              <span className="service-index">{String(services.indexOf(service) + 1).padStart(2, '0')}</span>
              <span className="service-main">
                <strong>{service.title}</strong>
                <small>{service.description}</small>
              </span>
              <span className="service-meta">
                <strong>{formatMoney(service.price)}</strong>
                <small>{service.durationMin} мин</small>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="flow-section">
        <SectionTitle eyebrow="02 · Команда" title="Выберите мастера" />
        <div className="specialist-grid">
          {availableSpecialists.map((specialist) => (
            <button
              className={`specialist-card ${specialist.id === selectedSpecialist.id ? 'selected' : ''}`}
              type="button"
              key={specialist.id}
              onClick={() => handleSpecialistSelect(specialist.id)}
            >
              <ImageFallback
                src={specialist.image}
                alt={specialist.name}
                initials={specialist.initials}
                gradient={specialist.accent}
                className="specialist-avatar"
              />
              <span>
                <small className="specialist-signature">atelier expert</small>
                <strong>{specialist.name}</strong>
                <small>{specialist.role}</small>
                <em>
                  <Star size={13} fill="currentColor" /> {specialist.rating} · {specialist.reviewCount}
                </em>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="flow-section">
        <SectionTitle eyebrow="03 · Визит" title="Дата и время" />
        <div className="date-strip" aria-label="Выбор даты">
          {demoDates.map((item) => (
            <button
              className={`date-pill ${item === date ? 'selected' : ''}`}
              type="button"
              key={item}
              onClick={() => {
                setDate(item);
                idempotencyKeyRef.current = crypto.randomUUID();
                setTime('');
                setSuccess(null);
                setConflictSlot('');
              }}
            >
              <span>{formatDate(item).split(',')[0]}</span>
              <strong>{formatDate(item).split(' ').slice(1).join(' ')}</strong>
            </button>
          ))}
        </div>

        <div className="slot-legend" aria-label="Обозначения времени">
          <span><i className="free" /> свободно</span>
          <span><i className="busy" /> занято</span>
          <span><i className="waitlist" /> лист ожидания</span>
          <span><i className="conflict" /> конфликт</span>
        </div>
        {availabilityError && (
          <div className="inline-error" role="alert">
            <p>{availabilityError}</p>
            <button className="secondary-button compact" type="button" onClick={() => setAvailabilityRetry((value) => value + 1)}>
              <RefreshCw size={16} /> Повторить загрузку
            </button>
          </div>
        )}
        {!isAvailabilityLoading && !availabilityError && availableTimes.length === 0 && (
          <EmptyState title="Свободных окон нет" text="Выберите другого мастера или дату." />
        )}
        <div
          className="slot-grid"
          aria-busy={isAvailabilityLoading}
          aria-disabled={Boolean(availabilityError) || isAvailabilityLoading}
        >
          {selectedSpecialist.slots.map((slot) => {
            const occupied = !availableTimes.includes(slot);
            const waitlistKey = `${selectedSpecialist.id}-${date}-${slot}`;
            const inWaitlist = waitlistEntries.includes(waitlistKey);
            return (
              <button
                className={`slot-button ${slot === time ? 'selected' : ''} ${occupied ? 'occupied' : 'free'} ${inWaitlist ? 'waitlisted' : ''} ${slot === conflictSlot ? 'conflict' : ''}`}
                type="button"
                key={slot}
                disabled={isAvailabilityLoading || Boolean(availabilityError)}
                aria-label={`${slot}: ${slot === conflictSlot ? 'конфликт записи' : inWaitlist ? 'вы в листе ожидания' : occupied ? 'занято, можно встать в лист ожидания' : slot === time ? 'выбрано' : 'свободно'}`}
                onClick={() => {
                  if (isAvailabilityLoading || availabilityError) return;
                  if (occupied) {
                    joinWaitlist(slot);
                    return;
                  }
                  setTime(slot);
                  idempotencyKeyRef.current = crypto.randomUUID();
                  setWaitlistNotice('');
                  setSuccess(null);
                  setError('');
                  setConflictSlot('');
                  setPaymentStatus('idle');
                  setPaymentSession(null);
                }}
              >
                <strong>{slot}</strong>
                <span>{slot === conflictSlot ? 'конфликт' : inWaitlist ? 'в ожидании' : occupied ? 'занято' : slot === time ? 'выбрано' : 'свободно'}</span>
              </button>
            );
          })}
        </div>
        {waitlistNotice && <p className="waitlist-note">{waitlistNotice}</p>}
      </section>

      <section className="confirmation-panel">
        <div>
          <p>04 · Подтверждение</p>
          <strong>{selectedService.title}</strong>
          <small>
            {selectedSpecialist.name} · {formatDate(date, 'long')} · {confirmationTime || 'выберите слот'}
          </small>
        </div>
        <div className="trust-grid" aria-label="Условия записи">
          <span>
            <ShieldCheck size={15} /> {businessProfile.cancellation}
          </span>
          <span>
            <Bell size={15} /> Напоминание за день и за 2 часа
          </span>
          <span>
            <Phone size={15} /> Код подтверждения в Telegram
          </span>
        </div>
        <PaymentPanel
          amount={prepayAmount}
          disabled={!time}
          mode={settings.paymentMode}
          method={paymentMethod}
          session={paymentSession}
          status={paymentStatus}
          isLoading={isCreatingPayment}
          onAction={handlePaymentAction}
          onMethodChange={changePaymentMethod}
        />
        <button className="code-button" type="button" onClick={() => setPhoneCodeSent(true)}>
          {phoneCodeSent ? 'SIMULATED: код 4281 показан' : 'Показать SIMULATED Telegram-код'}
        </button>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Комментарий для специалиста"
          rows={3}
          maxLength={160}
        />
        <small className="note-limit">{note.length}/160</small>
        {error && <p className="inline-error">{error}</p>}
        <button
          className="primary-button"
          type="button"
          disabled={!time || paymentStatus !== 'paid' || isSaving || Boolean(success)}
          onClick={handleCreate}
        >
          {isSaving ? <Loader2 className="spin" size={18} /> : <Check size={18} />}
          {isSaving ? 'Создаем запись' : success ? 'Запись создана' : 'Подтвердить после оплаты'}
        </button>
        {success && (
          <BookingPass
            booking={success}
            service={selectedService}
            specialist={selectedSpecialist}
            onOpenBookings={onOpenBookings}
            passRef={successRef}
          />
        )}
      </section>
    </main>
  );
}

function BookingPass({
  booking,
  service,
  specialist,
  onOpenBookings,
  passRef,
}: {
  booking: Booking;
  service: Service;
  specialist: Specialist;
  onOpenBookings: () => void;
  passRef: React.RefObject<HTMLElement>;
}) {
  return (
    <article className="booking-pass" ref={passRef} aria-live="polite">
      <header>
        <span>Atelier Vera</span>
        <b>confirmed</b>
      </header>
      <div className="pass-date">
        <strong>{booking.time}</strong>
        <span>{formatDate(booking.date, 'long')}</span>
      </div>
      <div className="pass-details">
        <span>{service.title}</span>
        <span>{specialist.name}</span>
        <span>{formatMoney(service.price)}</span>
      </div>
      <div className="pass-footer">
        <span>AV-{booking.id.slice(-6)}</span>
        <button type="button" onClick={onOpenBookings}>Мои записи →</button>
      </div>
    </article>
  );
}

function PaymentPanel({
  amount,
  disabled,
  mode,
  method,
  session,
  status,
  isLoading,
  onAction,
  onMethodChange,
}: {
  amount: number;
  disabled: boolean;
  mode: PaymentMode;
  method: PaymentMethod;
  session: PaymentSession | null;
  status: PaymentStatus;
  isLoading: boolean;
  onAction: () => void;
  onMethodChange: (method: PaymentMethod) => void;
}) {
  const selectedMethod = getPaymentMethod(method);
  const actionLabel =
    status === 'paid'
      ? 'Оплата подтверждена'
      : status === 'invoice'
        ? 'Подтвердить оплату в демо'
        : 'Сформировать счет';

  return (
    <section className="payment-panel" aria-label="Оплата записи">
      <div className="payment-head">
        <span>Оплата</span>
        <strong>{formatMoney(amount)}</strong>
      </div>
      <div className="payment-method-list" role="radiogroup" aria-label="Способ оплаты">
        {paymentMethods.map((item) => {
          const selected = item.id === method;
          const Icon = item.id === 'telegram-stars' ? Star : item.id === 'sbp' ? Landmark : CreditCard;
          return (
            <button
              className={selected ? 'payment-method selected' : 'payment-method'}
              type="button"
              key={item.id}
              role="radio"
              aria-checked={selected}
              disabled={status === 'paid'}
              onClick={() => onMethodChange(item.id)}
            >
              <Icon size={17} />
              <span>
                <strong>{item.title}</strong>
                <small>{item.short}</small>
              </span>
            </button>
          );
        })}
      </div>
      <div className={`payment-status ${status}`}>
          <strong>{selectedMethod.title} · SIMULATED {mode === 'production' ? 'production contract' : 'test'}</strong>
        <span>{selectedMethod.details}</span>
        {session && (
          <code>
            {session.endpoint} · {session.id}
          </code>
        )}
      </div>
      <button className="secondary-button payment-action" type="button" disabled={disabled || status === 'paid'} onClick={onAction}>
        {isLoading ? <Loader2 className="spin" size={16} /> : status === 'paid' ? <Check size={16} /> : <CreditCard size={16} />}
        {isLoading ? 'Создаем счет' : actionLabel}
      </button>
    </section>
  );
}

function MyBookings({
  bookings,
  services,
  specialists,
  onCancel,
  onReschedule,
}: {
  bookings: Booking[];
  services: Service[];
  specialists: Specialist[];
  onCancel: (id: string) => Promise<void>;
  onReschedule: (id: string, date: string, time: string) => Promise<void>;
}) {
  const [filter, setFilter] = useState<'active' | 'past'>('active');
  const [busyId, setBusyId] = useState('');
  const [rescheduleId, setRescheduleId] = useState('');
  const [rescheduleDate, setRescheduleDate] = useState(demoDates[1]);
  const [rescheduleTime, setRescheduleTime] = useState('');
  const [rescheduleError, setRescheduleError] = useState('');
  const userBookings = bookings.filter((booking) => booking.clientPhone === currentClient.phone);
  const visibleBookings = userBookings.filter((booking) => (filter === 'active' ? !isPastBooking(booking) : isPastBooking(booking)));

  const cancel = async (id: string) => {
    setBusyId(id);
    await onCancel(id);
    setBusyId('');
  };

  const applyReschedule = async (booking: Booking) => {
    const specialist = getSpecialist(specialists, booking.specialistId);
    const targetTime = rescheduleTime || specialist?.slots[0] || booking.time;
    setBusyId(`move-${booking.id}`);
    setRescheduleError('');
    try {
      await onReschedule(booking.id, rescheduleDate, targetTime);
      setRescheduleId('');
      setRescheduleTime('');
    } catch (caught) {
      setRescheduleError(caught instanceof Error ? caught.message : 'Не удалось перенести запись.');
    } finally {
      setBusyId('');
    }
  };

  return (
    <main className="screen">
      <div className="segmented">
        <button className={filter === 'active' ? 'selected' : ''} type="button" onClick={() => setFilter('active')}>
          Активные
        </button>
        <button className={filter === 'past' ? 'selected' : ''} type="button" onClick={() => setFilter('past')}>
          Прошлые
        </button>
      </div>

      {visibleBookings.length === 0 ? (
        <EmptyState
          title={filter === 'active' ? 'Активных записей нет' : 'История пока пустая'}
          text="Когда появится запись, она будет здесь с датой, статусом и быстрым действием."
        />
      ) : (
        <div className="booking-list">
          {visibleBookings.map((booking) => {
            const service = getService(services, booking.serviceId);
            const specialist = getSpecialist(specialists, booking.specialistId);
            return (
              <article className="booking-card" key={booking.id}>
                <div className="booking-card-top">
                  <span className={`status-badge ${statusCopy[booking.status].tone}`}>
                    {statusCopy[booking.status].label}
                  </span>
                  <small>{formatDate(booking.date, 'long')}</small>
                </div>
                <h2>{service?.title}</h2>
                <p>
                  {specialist?.name} · {booking.time} · {service ? formatMoney(service.price) : ''}
                </p>
                {booking.note && <blockquote>{booking.note}</blockquote>}
                {!isPastBooking(booking) && (
                  <div className="booking-actions">
                    <button
                      className="secondary-button compact"
                      type="button"
                      onClick={() => {
                        setRescheduleId(rescheduleId === booking.id ? '' : booking.id);
                        setRescheduleDate(demoDates[1]);
                        setRescheduleTime(specialist?.slots[0] ?? booking.time);
                        setRescheduleError('');
                      }}
                    >
                      <RefreshCw size={16} />
                      Перенести
                    </button>
                    <button className="ghost-danger" type="button" onClick={() => cancel(booking.id)} disabled={busyId === booking.id}>
                      {busyId === booking.id ? <Loader2 className="spin" size={16} /> : <X size={16} />}
                      Отменить
                    </button>
                  </div>
                )}
                {rescheduleId === booking.id && !isPastBooking(booking) && specialist && (
                  <div className="reschedule-panel">
                    <label>
                      День
                      <select value={rescheduleDate} onChange={(event) => setRescheduleDate(event.target.value)}>
                        {demoDates.slice(1).map((item) => (
                          <option value={item} key={item}>
                            {formatDate(item, 'long')}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Время
                      <select value={rescheduleTime} onChange={(event) => setRescheduleTime(event.target.value)}>
                        {specialist.slots.map((slot) => (
                          <option value={slot} key={slot}>
                            {slot}
                          </option>
                        ))}
                      </select>
                    </label>
                    {rescheduleError && <p className="inline-error">{rescheduleError}</p>}
                    <button
                      className="primary-button"
                      type="button"
                      disabled={busyId === `move-${booking.id}`}
                      onClick={() => applyReschedule(booking)}
                    >
                      {busyId === `move-${booking.id}` ? <Loader2 className="spin" size={16} /> : <Clock size={16} />}
                      Подтвердить перенос
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}

function AdminPanel({
  bookings,
  blockedSlots,
  services,
  specialists,
  onStatusChange,
  onBlockSlot,
  onUnblockSlot,
}: {
  bookings: Booking[];
  blockedSlots: BlockedSlot[];
  services: Service[];
  specialists: Specialist[];
  onStatusChange: (id: string, status: BookingStatus) => Promise<void>;
  onBlockSlot: (slot: Omit<BlockedSlot, 'id'>) => Promise<void>;
  onUnblockSlot: (id: string) => Promise<void>;
}) {
  const [date, setDate] = useState(demoDates[0]);
  const [specialistId, setSpecialistId] = useState(specialists[0]?.id ?? '');
  const [time, setTime] = useState(specialists[0]?.slots[0] ?? '');
  const [reason, setReason] = useState('Технический перерыв');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const dayBookings = bookings
    .filter((booking) => booking.date === date)
    .sort((a, b) => a.time.localeCompare(b.time));
  const dayBlocked = blockedSlots.filter((slot) => slot.date === date);
  const selectedSpecialist = getSpecialist(specialists, specialistId) ?? specialists[0];

  useEffect(() => {
    if (selectedSpecialist?.slots[0]) setTime(selectedSpecialist.slots[0]);
  }, [selectedSpecialist]);

  const changeStatus = async (id: string, status: BookingStatus) => {
    setBusy(`${id}-${status}`);
    await onStatusChange(id, status);
    setBusy('');
  };

  const block = async () => {
    if (!selectedSpecialist || !time) return;
    setBusy('block');
    setError('');
    try {
      await onBlockSlot({
        specialistId: selectedSpecialist.id,
        date,
        time,
        reason,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось заблокировать слот.');
    } finally {
      setBusy('');
    }
  };

  return (
    <main className="screen admin-screen">
      <section className="admin-summary">
        <div>
          <span>Записи</span>
          <strong>{dayBookings.length}</strong>
        </div>
        <div>
          <span>Занято</span>
          <strong>{dayBookings.filter((booking) => booking.status !== 'cancelled').length + dayBlocked.length}</strong>
        </div>
        <div>
          <span>Блоки</span>
          <strong>{dayBlocked.length}</strong>
        </div>
      </section>

      <section className="flow-section">
        <SectionTitle eyebrow="День" title="Расписание" />
        <div className="date-strip">
          {demoDates.map((item) => (
            <button className={`date-pill ${item === date ? 'selected' : ''}`} type="button" key={item} onClick={() => setDate(item)}>
              <span>{formatDate(item).split(',')[0]}</span>
              <strong>{formatDate(item).split(' ').slice(1).join(' ')}</strong>
            </button>
          ))}
        </div>
      </section>

      <section className="flow-section">
        <SectionTitle eyebrow="Управление" title="Блокировка слота" />
        <div className="admin-form">
          <label>
            Специалист
            <select value={specialistId} onChange={(event) => setSpecialistId(event.target.value)}>
              {specialists.map((specialist) => (
                <option value={specialist.id} key={specialist.id}>
                  {specialist.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Время
            <select value={time} onChange={(event) => setTime(event.target.value)}>
              {selectedSpecialist?.slots.map((slot) => (
                <option value={slot} key={slot}>
                  {slot}
                </option>
              ))}
            </select>
          </label>
          <label>
            Причина
            <input value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          {error && <p className="inline-error">{error}</p>}
          <button className="secondary-button" type="button" onClick={block} disabled={busy === 'block'}>
            {busy === 'block' ? <Loader2 className="spin" size={16} /> : <Ban size={16} />}
            Заблокировать
          </button>
        </div>
      </section>

      <section className="flow-section">
        <SectionTitle eyebrow="Список" title="Записи дня" />
        {dayBookings.length === 0 && dayBlocked.length === 0 ? (
          <EmptyState title="День свободен" text="Записей и блокировок на выбранную дату пока нет." />
        ) : (
          <div className="admin-list">
            {dayBookings.map((booking) => {
              const service = getService(services, booking.serviceId);
              const specialist = getSpecialist(specialists, booking.specialistId);
              return (
                <article className="admin-row" key={booking.id}>
                  <div className="admin-time">
                    <strong>{booking.time}</strong>
                    <span className={`status-dot ${statusCopy[booking.status].tone}`} />
                  </div>
                  <div className="admin-detail">
                    <h3>{booking.clientName}</h3>
                    <p>
                      {service?.title} · {specialist?.name}
                    </p>
                    <div className="admin-actions">
                      {(['pending', 'confirmed', 'completed', 'cancelled'] as BookingStatus[]).map((status) => (
                        <button
                          type="button"
                          key={status}
                          className={booking.status === status ? 'selected' : ''}
                          disabled={busy === `${booking.id}-${status}`}
                          onClick={() => changeStatus(booking.id, status)}
                        >
                          {statusCopy[status].label}
                        </button>
                      ))}
                    </div>
                  </div>
                </article>
              );
            })}

            {dayBlocked.map((slot) => {
              const specialist = getSpecialist(specialists, slot.specialistId);
              return (
                <article className="admin-row blocked-row" key={slot.id}>
                  <div className="admin-time">
                    <strong>{slot.time}</strong>
                    <span className="status-dot danger" />
                  </div>
                  <div className="admin-detail">
                    <h3>Слот заблокирован</h3>
                    <p>
                      {specialist?.name} · {slot.reason}
                    </p>
                    <button className="ghost-danger" type="button" onClick={() => onUnblockSlot(slot.id)}>
                      <X size={16} />
                      Снять блок
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

function SettingsPanel({
  settings,
  onChange,
}: {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
}) {
  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    onChange({ ...settings, [key]: value });
  };

  return (
    <main className="screen settings-screen">
      <section className="settings-card">
        <SectionTitle eyebrow="Платежи" title="Режим и провайдер" />
        <div className="settings-segmented" role="group" aria-label="Режим оплаты">
          <button
            className={settings.paymentMode === 'test' ? 'selected' : ''}
            type="button"
            onClick={() => update('paymentMode', 'test')}
          >
            Test
          </button>
          <button
            className={settings.paymentMode === 'production' ? 'selected' : ''}
            type="button"
            onClick={() => update('paymentMode', 'production')}
          >
            Production
          </button>
        </div>
        <label>
          Метод по умолчанию
          <select
            value={settings.defaultPaymentMethod}
            onChange={(event) => update('defaultPaymentMethod', event.target.value as PaymentMethod)}
          >
            {paymentMethods.map((method) => (
              <option value={method.id} key={method.id}>
                {method.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Merchant label
          <input
            value={settings.merchantLabel}
            onChange={(event) => update('merchantLabel', event.target.value)}
            maxLength={80}
          />
        </label>
      </section>

      <section className="settings-card">
        <SectionTitle eyebrow="Уведомления" title="Telegram-сервис" />
        <label>
          Напоминания
          <select value={settings.reminders} onChange={(event) => update('reminders', event.target.value as AppSettings['reminders'])}>
            <option value="both">За день и за 2 часа</option>
            <option value="day">Только за день</option>
            <option value="two-hours">Только за 2 часа</option>
          </select>
        </label>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={settings.telegramReceipts}
            onChange={(event) => update('telegramReceipts', event.target.checked)}
          />
          <span>Отправлять чек и статус оплаты через бота</span>
        </label>
      </section>

      <section className="settings-card">
        <SectionTitle eyebrow="Backend" title="Production endpoints" />
        <div className="endpoint-list">
          {paymentMethods.map((method) => (
            <code key={method.id}>{method.endpoint}</code>
          ))}
          <code>/api/payments/webhook/yookassa</code>
          <code>/api/telegram/pre-checkout</code>
        </div>
        <p className="settings-note">
          Bot token, ShopID и secret key остаются на сервере. Мини-апп получает только invoice link или confirmation_url.
        </p>
      </section>
    </main>
  );
}

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="section-title">
      <span>{eyebrow}</span>
      <h2>{title}</h2>
    </div>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty-state">
      <Sparkles size={22} />
      <h2>{title}</h2>
      <p>{text}</p>
    </div>
  );
}

function BottomNav({ activeTab, onTabChange }: { activeTab: TabKey; onTabChange: (tab: TabKey) => void }) {
  const items = [
    { id: 'booking' as const, label: 'Запись', icon: Home },
    { id: 'my' as const, label: 'Мои', icon: CalendarDays },
    { id: 'admin' as const, label: 'Админ', icon: LayoutDashboard },
    { id: 'settings' as const, label: 'Настройки', icon: Settings },
  ];

  return (
    <nav className="bottom-nav">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            className={activeTab === item.id ? 'selected' : ''}
            type="button"
            key={item.id}
            onClick={() => onTabChange(item.id)}
          >
            <Icon size={19} />
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}

function LoadingShell() {
  return (
    <div className="phone-shell loading-shell">
      <div className="skeleton header-skeleton" />
      <div className="skeleton hero-skeleton" />
      <div className="skeleton row-skeleton" />
      <div className="skeleton row-skeleton short" />
    </div>
  );
}

export function App() {
  const shellRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('booking');
  const [services, setServices] = useState<Service[]>([]);
  const [specialists, setSpecialists] = useState<Specialist[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [blockedSlots, setBlockedSlots] = useState<BlockedSlot[]>([]);
  const [settings, setSettings] = useState<AppSettings>(readSettings);
  const [isLoading, setIsLoading] = useState(true);
  const reducedMotion = useReducedMotionPreference();

  useEffect(() => {
    initTelegramShell();

    api.bootstrap().then((payload) => {
      setServices(payload.services);
      setSpecialists(payload.specialists);
      setBookings(payload.bookings);
      setBlockedSlots(payload.blockedSlots);
      setIsLoading(false);
    });
  }, []);

  useEffect(() => {
    writeSettings(settings);
  }, [settings]);

  const cancelBooking = async (id: string) => {
    const nextBookings = await api.cancelBooking(id);
    setBookings(nextBookings);
  };

  const rescheduleBooking = async (id: string, date: string, time: string) => {
    const nextBookings = await api.rescheduleBooking(id, date, time);
    setBookings(nextBookings);
  };

  const updateBookingStatus = async (id: string, status: BookingStatus) => {
    const nextBookings = await api.updateBookingStatus(id, status);
    setBookings(nextBookings);
  };

  const blockSlot = async (slot: Omit<BlockedSlot, 'id'>) => {
    const nextBlocked = await api.blockSlot(slot);
    setBlockedSlots(nextBlocked);
  };

  const unblockSlot = async (id: string) => {
    const nextBlocked = await api.unblockSlot(id);
    setBlockedSlots(nextBlocked);
  };

  useGSAP(
    () => {
      if (reducedMotion || !shellRef.current) return;
      const targets = shellRef.current.querySelectorAll('.app-header, .screen > *');
      if (targets.length === 0) return;
      gsap.fromTo(
        targets,
        { autoAlpha: 0, y: 18 },
        { autoAlpha: 1, y: 0, duration: 0.45, ease: 'power3.out', stagger: 0.045 },
      );
    },
    { dependencies: [activeTab, reducedMotion], scope: shellRef, revertOnUpdate: true },
  );

  if (isLoading) return <LoadingShell />;

  return (
    <div className="app-root">
      <div className="phone-shell" ref={shellRef}>
        <AppHeader activeTab={activeTab} onTabChange={setActiveTab} />
        {activeTab === 'booking' && (
          <BookingFlow
            services={services}
            specialists={specialists}
            bookings={bookings}
            blockedSlots={blockedSlots}
            settings={settings}
            onCreated={(booking) => setBookings((current) => [booking, ...current])}
            onOpenBookings={() => setActiveTab('my')}
          />
        )}
        {activeTab === 'my' && (
          <MyBookings
            bookings={bookings}
            services={services}
            specialists={specialists}
            onCancel={cancelBooking}
            onReschedule={rescheduleBooking}
          />
        )}
        {activeTab === 'admin' && (
          <AdminPanel
            bookings={bookings}
            blockedSlots={blockedSlots}
            services={services}
            specialists={specialists}
            onStatusChange={updateBookingStatus}
            onBlockSlot={blockSlot}
            onUnblockSlot={unblockSlot}
          />
        )}
        {activeTab === 'settings' && <SettingsPanel settings={settings} onChange={setSettings} />}
        <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
      </div>
    </div>
  );
}
