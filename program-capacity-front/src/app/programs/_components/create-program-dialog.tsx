import { useNavigate } from 'react-router';
import { Dialog } from '@/components/ui/dialog';
import { ROUTES } from '@/constants/routes';
import { CreateProgramForm } from '@/domains/program';

type CreateProgramDialogProps = {
  isOpen: boolean;
  onClose: () => void;
};

export function CreateProgramDialog({ isOpen, onClose }: CreateProgramDialogProps) {
  const navigate = useNavigate();

  return (
    <Dialog title="New program" isOpen={isOpen} onClose={onClose}>
      <CreateProgramForm
        onCreated={(program) => {
          onClose();
          void navigate(ROUTES.programs.detail(program.id));
        }}
      />
    </Dialog>
  );
}
