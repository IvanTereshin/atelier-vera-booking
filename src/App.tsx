import {
  Ban,
  Bell,
  CalendarDays,
  Check,
  Clock,
  Home,
  LayoutDashboard,
  Loader2,
  MapPin,
  MessageCircle,
  Phone,
  RefreshCw,
  Scissors,
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
import { api, isSlotOccupied } from './mockApi';
import { initTelegramShell } from './telegram';
import type { BlockedSlot, Booking, BookingStatus, Service, Specialist, TabKey } from './types';

const currentClient = {
  name: 'Иван Терешин',
  phone: '+7 900 120-44-18',
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
  const title = activeTab === 'booking' ? businessProfile.name : activeTab === 'my' ? 'Мои записи' : 'Админ-день';

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
        alt="Studio interior"
        initials="LB"
        gradient="linear-gradient(135deg, #eef6f1, #cfe3ef 55%, #f5d8c8)"
        className="studio-image"
      />
      <div className="studio-copy">
        <span>Ближайшее окно: {businessProfile.nearestSlot}</span>
        <strong>{businessProfile.name}</strong>
        <small>{businessProfile.subtitle}</small>
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
  const steps = ['Услуга', 'Мастер', 'Время', 'Подтверждение'];

  return (
    <section className="booking-timeline" aria-label="Шаги записи">
      {steps.map((step, index) => (
        <div className={index <= currentStep ? 'timeline-step active' : 'timeline-step'} key={step}>
          <span>{index + 1}</span>
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
  onCreated,
  onOpenBookings,
}: {
  services: Service[];
  specialists: Specialist[];
  bookings: Booking[];
  blockedSlots: BlockedSlot[];
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
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<Booking | null>(null);
  const successRef = useRef<HTMLDivElement>(null);
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

  const snapshot = { bookings, blockedSlots };
  const confirmationTime = success?.time ?? time;
  const currentStep = time ? 3 : selectedSpecialist ? 2 : selectedService ? 1 : 0;

  useGSAP(
    () => {
      if (reducedMotion || !successRef.current) return;
      gsap.fromTo(
        successRef.current,
        { autoAlpha: 0, y: 18, scale: 0.98 },
        { autoAlpha: 1, y: 0, scale: 1, duration: 0.42, ease: 'power3.out' },
      );
    },
    { dependencies: [success?.id, reducedMotion], scope: successRef },
  );

  const handleServiceSelect = (id: string) => {
    setServiceId(id);
    setTime('');
    setSuccess(null);
    setError('');
  };

  const handleSpecialistSelect = (id: string) => {
    setSpecialistId(id);
    setTime('');
    setSuccess(null);
    setError('');
  };

  const handleCreate = async () => {
    if (!selectedService || !selectedSpecialist || !time) return;

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
      });
      setSuccess(booking);
      setTime('');
      setNote('');
      onCreated(booking);
    } catch (caught) {
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
  };

  if (!selectedService || !selectedSpecialist) {
    return <EmptyState title="Нет доступных услуг" text="Добавьте услуги и специалистов в демо-данные." />;
  }

  return (
    <main className="screen booking-screen">
      <StudioIntro />
      <BookingTimeline currentStep={currentStep} />

      <section className="flow-section">
        <SectionTitle eyebrow="Прайс-лист" title="Выберите услугу" />
        <div className="service-list">
          {services.map((service) => (
            <button
              className={`service-row ${service.id === serviceId ? 'selected' : ''}`}
              type="button"
              key={service.id}
              onClick={() => handleServiceSelect(service.id)}
            >
              <span className="service-icon">
                <Scissors size={18} />
              </span>
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
        <SectionTitle eyebrow="Команда" title="Специалист" />
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
        <SectionTitle eyebrow="Календарь" title="Дата и время" />
        <div className="date-strip" aria-label="Выбор даты">
          {demoDates.map((item) => (
            <button
              className={`date-pill ${item === date ? 'selected' : ''}`}
              type="button"
              key={item}
              onClick={() => {
                setDate(item);
                setTime('');
                setSuccess(null);
              }}
            >
              <span>{formatDate(item).split(',')[0]}</span>
              <strong>{formatDate(item).split(' ').slice(1).join(' ')}</strong>
            </button>
          ))}
        </div>

        <div className="slot-grid">
          {selectedSpecialist.slots.map((slot) => {
            const occupied = isSlotOccupied(snapshot, selectedSpecialist.id, date, slot);
            const waitlistKey = `${selectedSpecialist.id}-${date}-${slot}`;
            const inWaitlist = waitlistEntries.includes(waitlistKey);
            return (
              <button
                className={`slot-button ${slot === time ? 'selected' : ''} ${occupied ? 'occupied' : ''} ${inWaitlist ? 'waitlisted' : ''}`}
                type="button"
                key={slot}
                onClick={() => {
                  if (occupied) {
                    joinWaitlist(slot);
                    return;
                  }
                  setTime(slot);
                  setWaitlistNotice('');
                  setSuccess(null);
                  setError('');
                }}
              >
                {slot}
                {occupied && <span>{inWaitlist ? 'в ожидании' : 'лист ожидания'}</span>}
              </button>
            );
          })}
        </div>
        {waitlistNotice && <p className="waitlist-note">{waitlistNotice}</p>}
      </section>

      <section className="confirmation-panel">
        <div>
          <p>Подтверждение</p>
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
        <button className="code-button" type="button" onClick={() => setPhoneCodeSent(true)}>
          {phoneCodeSent ? 'Код 4281 отправлен в Telegram' : 'Отправить mock-код подтверждения'}
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
        <button className="primary-button" type="button" disabled={!time || isSaving || Boolean(success)} onClick={handleCreate}>
          {isSaving ? <Loader2 className="spin" size={18} /> : <Check size={18} />}
          {isSaving ? 'Создаем запись' : success ? 'Запись создана' : 'Подтвердить запись'}
        </button>
        {success && (
          <div className="success-state" ref={successRef}>
            <Check size={18} />
            <span>
              Запись создана на {success.time}.{' '}
              <button type="button" onClick={onOpenBookings}>
                Открыть мои записи
              </button>
            </span>
          </div>
        )}
      </section>
    </main>
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
      if (reducedMotion) return;
      gsap.fromTo(
        '.app-header, .screen > *',
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
        <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
      </div>
    </div>
  );
}
