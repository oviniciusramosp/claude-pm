// panel/src/components/setup-required-banner.tsx

import { AlertCircle, Settings01 } from '@untitledui/icons';
import { Button } from '@/components/base/buttons/button';
import { Icon } from './icon';

export function SetupRequiredBanner({
  onNavigateToSetup
}: {
  onNavigateToSetup: () => void;
}) {
  return (
    <div className="mb-6 rounded-xl border border-warning-secondary bg-warning-secondary p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-lg bg-warning-primary/10">
          <Icon icon={AlertCircle} className="size-5 text-warning-primary" />
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          <div className="space-y-1">
            <h3 className="m-0 text-md font-semibold text-warning-primary">
              Setup Required
            </h3>
            <p className="m-0 text-sm text-warning-secondary">
              This page is disabled until you complete the setup configuration.
              Please configure your Claude OAuth Token and Working Directory to enable all features.
            </p>
          </div>

          <Button
            size="sm"
            color="secondary"
            iconLeading={Settings01}
            onPress={onNavigateToSetup}
          >
            Go to Setup
          </Button>
        </div>
      </div>
    </div>
  );
}
