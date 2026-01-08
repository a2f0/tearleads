import { Link, type LinkProps, useLocation } from 'react-router-dom';

interface LinkWithFromProps extends Omit<LinkProps, 'state'> {
  fromLabel?: string;
}

export function LinkWithFrom({
  fromLabel,
  to,
  children,
  ...props
}: LinkWithFromProps) {
  const location = useLocation();

  return (
    <Link
      to={to}
      state={{
        from: location.pathname,
        fromLabel
      }}
      {...props}
    >
      {children}
    </Link>
  );
}
