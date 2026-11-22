CREATE TABLE public.finance_accounts (
  user_id TEXT NOT NULL REFERENCES public.users(id),
  id UUID NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('cash', 'bank', 'card', 'savings')),
  currency TEXT NOT NULL CHECK (currency IN ('KGS', 'RUB', 'USD')),
  opening BIGINT NOT NULL,
  archived BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, id, currency)
);

CREATE TABLE public.finance_goals (
  user_id TEXT NOT NULL,
  id UUID NOT NULL,
  account_id UUID NOT NULL,
  currency TEXT NOT NULL,
  name TEXT NOT NULL,
  target BIGINT NOT NULL CHECK (target > 0),
  deadline DATE,
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, id, account_id),
  FOREIGN KEY (user_id, account_id, currency) REFERENCES public.finance_accounts(user_id, id, currency)
);

CREATE TABLE public.finance_entries (
  user_id TEXT NOT NULL,
  id UUID NOT NULL,
  account_id UUID NOT NULL,
  destination_id UUID,
  goal_id UUID,
  currency TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('income', 'expense', 'transfer')),
  amount BIGINT NOT NULL CHECK (amount > 0),
  day DATE NOT NULL,
  category TEXT,
  note TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, account_id, currency) REFERENCES public.finance_accounts(user_id, id, currency),
  FOREIGN KEY (user_id, destination_id, currency) REFERENCES public.finance_accounts(user_id, id, currency),
  FOREIGN KEY (user_id, goal_id, destination_id) REFERENCES public.finance_goals(user_id, id, account_id),
  CHECK ((kind = 'transfer' AND destination_id IS NOT NULL AND destination_id <> account_id AND category IS NULL)
      OR (kind <> 'transfer' AND destination_id IS NULL AND goal_id IS NULL AND category IS NOT NULL))
);

CREATE INDEX finance_entries_day ON public.finance_entries(user_id, day DESC, id);

CREATE TABLE public.finance_budgets (
  user_id TEXT NOT NULL REFERENCES public.users(id),
  id UUID NOT NULL,
  category TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('KGS', 'RUB', 'USD')),
  month DATE NOT NULL CHECK (extract(day from month) = 1),
  amount BIGINT NOT NULL CHECK (amount > 0),
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, month, currency, category)
);
