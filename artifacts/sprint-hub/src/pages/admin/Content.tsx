import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { uploadFile } from "@/lib/uploads";
import {
  useListAdminModules,
  useCreateAdminModule,
  useUpdateAdminModule,
  useDeleteAdminModule,
  useCreateAdminEpisode,
  useUpdateAdminEpisode,
  useDeleteAdminEpisode,
  getListAdminModulesQueryKey,
  useGetMe,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Plus,
  GripVertical,
  Settings2,
  Trash2,
  Save,
  FileVideo,
  FileText,
  CheckSquare,
  X,
  ArrowLeft,
  Paperclip,
  Upload,
  FileIcon,
  BookOpen,
  Sparkles,
  Archive,
  Users,
  ClipboardList,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import type { AdminEpisode, AdminModule } from "@workspace/api-client-react";
import { AiCourseDraftDialog } from "./AiCourseDraftDialog";

type Course = {
  id: number;
  title: string;
  description: string;
  position: number;
  archived: boolean;
  moduleCount: number;
  clientCount: number;
};

const COURSES_KEY = ["admin", "courses"];
type CourseSelection = number | "unattached" | null;

export function AdminContent() {
  const queryClient = useQueryClient();
  const { data: me } = useGetMe();
  const isViewer = me?.role === "viewer";

  const { data: courses, isLoading: coursesLoading } = useQuery<Course[]>({
    queryKey: COURSES_KEY,
    queryFn: () => api<Course[]>("/admin/courses"),
  });
  const { data: modules, isLoading: modulesLoading } = useListAdminModules();

  const [selectedCourseId, setSelectedCourseId] = useState<CourseSelection>(null);
  const [selectedModuleId, setSelectedModuleId] = useState<number | null>(null);
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<number | null>(null);
  const [isCreateCourseOpen, setIsCreateCourseOpen] = useState(false);
  const [isAiOpen, setIsAiOpen] = useState(false);

  const invalidateCourses = () => queryClient.invalidateQueries({ queryKey: COURSES_KEY });
  const invalidateModules = () =>
    queryClient.invalidateQueries({ queryKey: getListAdminModulesQueryKey() });

  // ---------- Course mutations ----------
  const createCourse = useMutation({
    mutationFn: (data: { title: string; description: string }) =>
      api<Course>("/admin/courses", { method: "POST", json: data }),
    onSuccess: (c) => {
      toast.success("Course created");
      setIsCreateCourseOpen(false);
      setSelectedCourseId(c.id);
      setSelectedModuleId(null);
      setSelectedEpisodeId(null);
      invalidateCourses();
    },
  });
  const updateCourse = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Pick<Course, "title" | "description" | "archived">> }) =>
      api<Course>(`/admin/courses/${id}`, { method: "PATCH", json: data }),
    onSuccess: () => {
      toast.success("Course saved");
      invalidateCourses();
    },
  });
  const deleteCourse = useMutation({
    mutationFn: ({ id, cascade }: { id: number; cascade?: boolean }) =>
      api<void>(`/admin/courses/${id}${cascade ? "?cascade=1" : ""}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Course deleted");
      setSelectedCourseId(null);
      setSelectedModuleId(null);
      setSelectedEpisodeId(null);
      invalidateCourses();
      invalidateModules();
    },
    onError: (err: Error) => toast.error(err.message || "Could not delete course"),
  });

  // ---------- Module mutations ----------
  const createModule = useCreateAdminModule({
    mutation: {
      onSuccess: async (data) => {
        // If we created from inside a selected course, attach it.
        if (typeof selectedCourseId === "number") {
          try {
            await api(`/admin/modules/${data.id}/course`, {
              method: "PATCH",
              json: { courseId: selectedCourseId },
            });
          } catch {
            /* surfaced by mutation onError chain */
          }
        }
        toast.success("Module created");
        invalidateModules();
        invalidateCourses();
        setSelectedModuleId(data.id);
      },
    },
  });
  const updateModule = useUpdateAdminModule({
    mutation: {
      onSuccess: () => {
        toast.success("Module updated");
        invalidateModules();
      },
    },
  });
  const deleteModule = useDeleteAdminModule({
    mutation: {
      onSuccess: () => {
        toast.success("Module deleted");
        setSelectedModuleId(null);
        setSelectedEpisodeId(null);
        invalidateModules();
        invalidateCourses();
      },
    },
  });

  // ---------- Episode mutations ----------
  const createEpisode = useCreateAdminEpisode({
    mutation: {
      onSuccess: (data) => {
        toast.success("Episode created");
        invalidateModules();
        setSelectedEpisodeId(data.id);
      },
    },
  });
  const updateEpisode = useUpdateAdminEpisode({
    mutation: {
      onSuccess: () => {
        toast.success("Episode updated");
        invalidateModules();
      },
    },
  });
  const deleteEpisode = useDeleteAdminEpisode({
    mutation: {
      onSuccess: () => {
        toast.success("Episode deleted");
        setSelectedEpisodeId(null);
        invalidateModules();
      },
    },
  });

  // ---------- Derived slices ----------
  const modulesByCourse = (() => {
    if (!modules) return [];
    return modules.filter((m) => {
      const cid = (m as unknown as { courseId: number | null }).courseId ?? null;
      if (selectedCourseId === "unattached") return cid == null;
      if (typeof selectedCourseId === "number") return cid === selectedCourseId;
      return false;
    });
  })();
  const unattachedCount = (modules ?? []).filter(
    (m) => ((m as unknown as { courseId: number | null }).courseId ?? null) == null,
  ).length;
  const selectedCourse =
    typeof selectedCourseId === "number" ? courses?.find((c) => c.id === selectedCourseId) ?? null : null;
  const selectedModule = modules?.find((m) => m.id === selectedModuleId) ?? null;
  const selectedEpisode = selectedModule?.episodes.find((e) => e.id === selectedEpisodeId) ?? null;

  // If the selected course/module disappears (delete, refresh), reset selection.
  useEffect(() => {
    if (typeof selectedCourseId === "number" && courses && !courses.some((c) => c.id === selectedCourseId)) {
      setSelectedCourseId(null);
      setSelectedModuleId(null);
      setSelectedEpisodeId(null);
    }
  }, [courses, selectedCourseId]);
  useEffect(() => {
    if (selectedModuleId && modules && !modules.some((m) => m.id === selectedModuleId)) {
      setSelectedModuleId(null);
      setSelectedEpisodeId(null);
    }
  }, [modules, selectedModuleId]);

  if (coursesLoading || modulesLoading) return <Skeleton className="h-screen w-full" />;

  const handleCreateCourse = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const title = String(fd.get("title") || "").trim();
    if (!title) {
      toast.error("Title required");
      return;
    }
    createCourse.mutate({ title, description: String(fd.get("description") || "") });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-secondary">Content</h1>
          <p className="text-muted-foreground mt-1">
            Courses contain modules. Modules contain episodes. Pick a course on the left to start.
          </p>
        </div>
        {!isViewer && (
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" onClick={() => setIsAiOpen(true)}>
              <Sparkles className="w-4 h-4 mr-2" /> Generate with AI
            </Button>
            <Button onClick={() => setIsCreateCourseOpen(true)}>
              <Plus className="w-4 h-4 mr-2" /> New Course
            </Button>
          </div>
        )}
      </div>

      <AiCourseDraftDialog
        open={isAiOpen}
        onOpenChange={setIsAiOpen}
        onCreated={(c) => {
          setSelectedCourseId(c.id);
          setSelectedModuleId(null);
          setSelectedEpisodeId(null);
          invalidateCourses();
          invalidateModules();
        }}
      />

      <Dialog open={isCreateCourseOpen} onOpenChange={setIsCreateCourseOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create course</DialogTitle>
            <DialogDescription>
              Courses bundle modules. Clients only see content from courses they have been assigned.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateCourse} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="course-title">Title</Label>
              <Input id="course-title" name="title" required placeholder="e.g. Premium Onboarding" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="course-desc">Description</Label>
              <Textarea id="course-desc" name="description" placeholder="Internal description (clients don't see this)." />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsCreateCourseOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createCourse.isPending}>
                {createCourse.isPending ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 lg:h-[calc(100vh-220px)]">
        {/* Left rail: courses + unattached bucket */}
        <div className="border rounded-xl bg-card overflow-hidden flex flex-col shadow-sm">
          <div className="p-4 border-b bg-muted/30 flex items-center justify-between">
            <h2 className="font-semibold text-secondary">Courses</h2>
            <Badge variant="secondary" className="text-[10px]">{(courses ?? []).length}</Badge>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {(courses ?? []).map((c) => {
              const isActive = selectedCourseId === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => {
                    setSelectedCourseId(c.id);
                    setSelectedModuleId(null);
                    setSelectedEpisodeId(null);
                  }}
                  className={`w-full text-left px-3 py-3 rounded-md transition-colors ${
                    isActive ? "bg-primary text-primary-foreground font-medium shadow-sm" : "hover:bg-muted text-foreground"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate flex items-center gap-2">
                      <BookOpen className="w-4 h-4 opacity-70 shrink-0" />
                      <span className="truncate">{c.title}</span>
                    </span>
                    {c.archived && (
                      <Badge variant="secondary" className="text-[10px]">Archived</Badge>
                    )}
                  </div>
                  <div
                    className={`text-xs mt-1 flex items-center gap-3 ${
                      isActive ? "text-primary-foreground/70" : "text-muted-foreground"
                    }`}
                  >
                    <span className="flex items-center gap-1">
                      <FileText className="w-3 h-3" /> {c.moduleCount}
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="w-3 h-3" /> {c.clientCount}
                    </span>
                  </div>
                </button>
              );
            })}
            {(courses ?? []).length === 0 && (
              <div className="text-center py-8 text-sm text-muted-foreground px-2">
                No courses yet. Create one to start grouping content.
              </div>
            )}
            {unattachedCount > 0 && (
              <button
                onClick={() => {
                  setSelectedCourseId("unattached");
                  setSelectedModuleId(null);
                  setSelectedEpisodeId(null);
                }}
                className={`w-full text-left px-3 py-3 rounded-md transition-colors mt-2 border-t border-dashed pt-3 ${
                  selectedCourseId === "unattached"
                    ? "bg-primary text-primary-foreground font-medium shadow-sm"
                    : "hover:bg-muted text-muted-foreground"
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <FileText className="w-4 h-4 opacity-70 shrink-0" /> Unattached modules
                </span>
                <div
                  className={`text-xs mt-1 ${
                    selectedCourseId === "unattached" ? "text-primary-foreground/70" : "text-muted-foreground"
                  }`}
                >
                  {unattachedCount} hidden from clients
                </div>
              </button>
            )}
          </div>
        </div>

        {/* Right pane */}
        <div className="lg:col-span-3 border rounded-xl bg-card overflow-hidden flex flex-col shadow-sm min-h-[60vh]">
          {selectedEpisode && selectedModule ? (
            <EpisodeEditor
              key={selectedEpisode.id}
              episode={selectedEpisode}
              onSave={(data) => updateEpisode.mutate({ id: selectedEpisode.id, data })}
              onDelete={() => deleteEpisode.mutate({ id: selectedEpisode.id })}
              onClose={() => setSelectedEpisodeId(null)}
              isViewer={isViewer}
            />
          ) : selectedModule ? (
            <ModuleDetailPane
              module={selectedModule}
              isViewer={isViewer}
              courses={courses ?? []}
              onBack={() => setSelectedModuleId(null)}
              onSave={(data) =>
                updateModule.mutate({
                  id: selectedModule.id,
                  data: {
                    title: data.title,
                    description: data.description,
                    published: data.published,
                    position: selectedModule.position,
                  },
                })
              }
              onDelete={() => {
                if (window.confirm(`Delete module "${selectedModule.title}"?`)) {
                  deleteModule.mutate({ id: selectedModule.id });
                }
              }}
              onAddEpisode={() =>
                createEpisode.mutate({
                  id: selectedModule.id,
                  data: {
                    title: "New Episode",
                    copy: "",
                    kind: "standard",
                    published: false,
                    requirePrevious: false,
                  },
                })
              }
              onSelectEpisode={(id) => setSelectedEpisodeId(id)}
            />
          ) : selectedCourse ? (
            <CourseDetailPane
              course={selectedCourse}
              modules={modulesByCourse}
              isViewer={isViewer}
              onSave={(data) => updateCourse.mutate({ id: selectedCourse.id, data })}
              onDelete={() => {
                const modN = selectedCourse.moduleCount ?? 0;
                const cliN = selectedCourse.clientCount ?? 0;
                const hasContent = modN > 0 || cliN > 0;
                const message = hasContent
                  ? `Delete "${selectedCourse.title}"?\n\nThis will permanently remove:\n• ${modN} module(s) and all their episodes\n• Every client's progress on those episodes\n• ${cliN} client course assignment(s)\n\nThis cannot be undone. Type-confirm by clicking OK.`
                  : `Delete "${selectedCourse.title}"? This cannot be undone.`;
                if (window.confirm(message)) {
                  deleteCourse.mutate({ id: selectedCourse.id, cascade: hasContent });
                }
              }}
              onSelectModule={(id) => setSelectedModuleId(id)}
              onAddModule={() =>
                createModule.mutate({
                  data: { title: "New Module", description: "", published: false },
                })
              }
            />
          ) : selectedCourseId === "unattached" ? (
            <UnattachedPane
              modules={modulesByCourse}
              isViewer={isViewer}
              onSelectModule={(id) => setSelectedModuleId(id)}
              onAddModule={() =>
                createModule.mutate({
                  data: { title: "New Module", description: "", published: false },
                })
              }
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground p-8 text-center">
              <div>
                <BookOpen className="w-12 h-12 mx-auto mb-4 opacity-40" />
                <div>Select a course on the left to view its modules and episodes.</div>
                {(courses ?? []).length === 0 && !isViewer && (
                  <Button className="mt-4" onClick={() => setIsCreateCourseOpen(true)}>
                    <Plus className="w-4 h-4 mr-2" /> Create your first course
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Course detail pane — title/desc/archive + list of its modules.
// ============================================================================
function CourseDetailPane({
  course,
  modules,
  isViewer,
  onSave,
  onDelete,
  onSelectModule,
  onAddModule,
}: {
  course: Course;
  modules: AdminModule[];
  isViewer: boolean;
  onSave: (data: { title: string; description: string; archived: boolean }) => void;
  onDelete: () => void;
  onSelectModule: (id: number) => void;
  onAddModule: () => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-6 border-b">
        <div className="flex justify-between items-start mb-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Course</div>
            <h2 className="text-2xl font-bold text-secondary">{course.title}</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {course.moduleCount} module{course.moduleCount === 1 ? "" : "s"} · {course.clientCount} client
              {course.clientCount === 1 ? "" : "s"} assigned
            </p>
          </div>
          {!isViewer && (
            <Button variant="destructive" size="sm" onClick={onDelete}>
              <Trash2 className="w-4 h-4 mr-2" /> Delete
            </Button>
          )}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (isViewer) return;
            const fd = new FormData(e.currentTarget);
            onSave({
              title: String(fd.get("title") || "").trim(),
              description: String(fd.get("description") || ""),
              archived: course.archived,
            });
          }}
          className="space-y-4 max-w-lg"
        >
          <div className="space-y-2">
            <Label>Title</Label>
            <Input name="title" defaultValue={course.title} readOnly={isViewer} required />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea name="description" defaultValue={course.description} readOnly={isViewer} />
          </div>
          <div className="flex items-center gap-3 pt-1">
            <Archive className="w-4 h-4 text-muted-foreground" />
            <Label className="flex-1">Archived</Label>
            <Switch
              checked={course.archived}
              disabled={isViewer}
              onCheckedChange={(c) =>
                onSave({ title: course.title, description: course.description, archived: c })
              }
            />
          </div>
          {!isViewer && (
            <Button type="submit">
              <Save className="w-4 h-4 mr-2" /> Save course
            </Button>
          )}
        </form>
      </div>

      <div className="p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold">Modules in this course</h3>
          {!isViewer && (
            <Button size="sm" onClick={onAddModule}>
              <Plus className="w-4 h-4 mr-2" /> Add Module
            </Button>
          )}
        </div>
        <div className="space-y-2">
          {modules.map((m, i) => (
            <button
              key={m.id}
              onClick={() => onSelectModule(m.id)}
              className="w-full text-left p-3 border rounded-lg bg-background hover:border-primary/50 cursor-pointer flex items-center justify-between group transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <GripVertical className="w-4 h-4 text-muted-foreground opacity-50 shrink-0" />
                <span className="text-sm font-medium w-6 shrink-0">{i + 1}.</span>
                <span className="font-medium text-secondary truncate">{m.title}</span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-xs text-muted-foreground">{m.episodes.length} ep</span>
                {!m.published && <Badge variant="secondary" className="text-[10px]">Draft</Badge>}
                <Settings2 className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </button>
          ))}
          {modules.length === 0 && (
            <div className="text-center py-8 text-sm text-muted-foreground border border-dashed rounded-lg">
              No modules in this course yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Unattached modules pane (for backfill / orphan modules).
// ============================================================================
function UnattachedPane({
  modules,
  isViewer,
  onSelectModule,
  onAddModule,
}: {
  modules: AdminModule[];
  isViewer: boolean;
  onSelectModule: (id: number) => void;
  onAddModule: () => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-secondary">Unattached modules</h2>
        <p className="text-sm text-muted-foreground mt-1">
          These modules aren't assigned to any course, so clients can't see them. Open one to assign it.
        </p>
      </div>
      {!isViewer && (
        <div className="mb-4 flex justify-end">
          <Button size="sm" variant="outline" onClick={onAddModule}>
            <Plus className="w-4 h-4 mr-2" /> Add Module
          </Button>
        </div>
      )}
      <div className="space-y-2">
        {modules.map((m) => (
          <button
            key={m.id}
            onClick={() => onSelectModule(m.id)}
            className="w-full text-left p-3 border rounded-lg bg-background hover:border-primary/50 cursor-pointer flex items-center justify-between group transition-colors"
          >
            <div className="flex items-center gap-3 min-w-0">
              <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="font-medium text-secondary truncate">{m.title}</span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-xs text-muted-foreground">{m.episodes.length} ep</span>
              {!m.published && <Badge variant="secondary" className="text-[10px]">Draft</Badge>}
              <Settings2 className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </button>
        ))}
        {modules.length === 0 && (
          <div className="text-center py-8 text-sm text-muted-foreground border border-dashed rounded-lg">
            No unattached modules.
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Module detail pane — same module editor as before, plus course selector.
// ============================================================================
function ModuleDetailPane({
  module: mod,
  isViewer,
  courses,
  onBack,
  onSave,
  onDelete,
  onAddEpisode,
  onSelectEpisode,
}: {
  module: AdminModule;
  isViewer: boolean;
  courses: Course[];
  onBack: () => void;
  onSave: (data: { title: string; description: string; published: boolean }) => void;
  onDelete: () => void;
  onAddEpisode: () => void;
  onSelectEpisode: (id: number) => void;
}) {
  const queryClient = useQueryClient();
  const currentCourseId = (mod as unknown as { courseId: number | null }).courseId ?? null;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-4 border-b flex items-center gap-2 bg-muted/10">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Back
        </Button>
        <span className="text-muted-foreground">/</span>
        <span className="font-semibold text-secondary truncate">{mod.title}</span>
      </div>
      <div className="p-6 border-b">
        <div className="flex justify-between items-start mb-4">
          <h2 className="text-xl font-bold">Module settings</h2>
          {!isViewer && (
            <Button variant="destructive" size="sm" onClick={onDelete}>
              <Trash2 className="w-4 h-4 mr-2" /> Delete
            </Button>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (isViewer) return;
            const fd = new FormData(e.currentTarget);
            onSave({
              title: String(fd.get("title") || "").trim(),
              description: String(fd.get("description") || ""),
              published: fd.get("published") === "true",
            });
          }}
          className="space-y-4 max-w-lg"
        >
          <div className="space-y-2">
            <Label>Module Title</Label>
            <Input name="title" defaultValue={mod.title} readOnly={isViewer} required />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea name="description" defaultValue={mod.description} readOnly={isViewer} />
          </div>
          <div className="flex items-center gap-2">
            <Label>Published</Label>
            <input type="hidden" name="published" value={mod.published ? "true" : "false"} />
            <Switch
              disabled={isViewer}
              defaultChecked={mod.published}
              onCheckedChange={(c) => {
                if (isViewer) return;
                onSave({ title: mod.title, description: mod.description, published: c });
              }}
            />
          </div>

          <div className="space-y-2">
            <Label>Course</Label>
            <Select
              value={currentCourseId == null ? "none" : String(currentCourseId)}
              disabled={isViewer}
              onValueChange={async (v) => {
                if (isViewer) return;
                const courseId = v === "none" ? null : Number(v);
                try {
                  await api(`/admin/modules/${mod.id}/course`, {
                    method: "PATCH",
                    json: { courseId },
                  });
                  toast.success("Course updated");
                  queryClient.invalidateQueries({ queryKey: getListAdminModulesQueryKey() });
                  queryClient.invalidateQueries({ queryKey: COURSES_KEY });
                } catch (err) {
                  toast.error((err as Error).message || "Could not change course");
                }
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a course" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— No course (hidden from clients)</SelectItem>
                {courses
                  .filter((c) => !c.archived || c.id === currentCourseId)
                  .map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.title}
                      {c.archived ? " (archived)" : ""}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          {!isViewer && (
            <Button type="submit">
              <Save className="w-4 h-4 mr-2" /> Save Module
            </Button>
          )}
        </form>
      </div>

      <div className="p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold">Episodes</h3>
          {!isViewer && (
            <Button size="sm" onClick={onAddEpisode}>
              <Plus className="w-4 h-4 mr-2" /> Add Episode
            </Button>
          )}
        </div>
        <div className="space-y-2">
          {mod.episodes.map((ep, i) => (
            <button
              key={ep.id}
              onClick={() => onSelectEpisode(ep.id)}
              className="w-full text-left p-3 border rounded-lg bg-background hover:border-primary/50 cursor-pointer flex items-center justify-between group transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <GripVertical className="w-4 h-4 text-muted-foreground opacity-50 shrink-0" />
                <span className="text-sm font-medium w-6 shrink-0">{i + 1}.</span>
                <span className="font-medium text-secondary truncate">{ep.title}</span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {ep.kind === "icp" ? (
                  <ClipboardList className="w-4 h-4 text-muted-foreground" />
                ) : ep.kind === "checklist" ? (
                  <CheckSquare className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <FileVideo className="w-4 h-4 text-muted-foreground" />
                )}
                {!ep.published && <Badge variant="secondary" className="text-[10px]">Draft</Badge>}
                <Settings2 className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </button>
          ))}
          {mod.episodes.length === 0 && (
            <div className="text-center py-8 text-sm text-muted-foreground border border-dashed rounded-lg">
              No episodes in this module.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Episode editor — preserved verbatim from previous Content.tsx (works today).
// ============================================================================
function EpisodeEditor({
  episode,
  onSave,
  onDelete,
  onClose,
  isViewer,
}: {
  episode: AdminEpisode;
  onSave: (d: any) => void;
  onDelete: () => void;
  onClose: () => void;
  isViewer: boolean;
}) {
  const [kind, setKind] = useState(episode.kind);
  const [videoUrl, setVideoUrl] = useState(episode.videoUrl || "");
  const [videoUploading, setVideoUploading] = useState(false);
  const videoFileRef = useRef<HTMLInputElement | null>(null);
  const [checklist, setChecklist] = useState<{ id: number; label: string; kind?: "check" | "url" | "text" }[]>(
    (episode.checklistItems || []).map((c: any) => ({ id: c.id, label: c.label, kind: c.kind ?? "check" })),
  );

  const handleVideoFile = async (file: File) => {
    if (videoUploading || isViewer) return;
    setVideoUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/episode-videos/upload", { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Upload failed (${res.status})`);
      }
      const json = (await res.json()) as { videoUrl: string };
      setVideoUrl(json.videoUrl);
      toast.success("Video uploaded. Click Save to attach it to this episode.");
    } catch (e) {
      toast.error((e as Error).message || "Upload failed");
    } finally {
      setVideoUploading(false);
      if (videoFileRef.current) videoFileRef.current.value = "";
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isViewer) return;
    const fd = new FormData(e.currentTarget);
    onSave({
      title: (fd.get("title") as string) ?? "",
      videoUrl: videoUrl || null,
      copy: (fd.get("copy") as string) ?? "",
      kind: kind,
      published: fd.get("published") === "true",
      requirePrevious: fd.get("requirePrevious") === "true",
      checklistItems: kind === "checklist" ? checklist : undefined,
    });
  };

  return (
    <div className="flex-1 flex flex-col h-full">
      <div className="p-4 border-b flex justify-between items-center bg-muted/10">
        <div className="flex items-center gap-2 min-w-0">
          <Button variant="ghost" size="sm" onClick={onClose}>
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to Module
          </Button>
          <span className="text-muted-foreground">/</span>
          <span className="font-semibold text-secondary truncate">{episode.title}</span>
        </div>
        {!isViewer && (
          <Button variant="destructive" size="sm" onClick={onDelete}>
            <Trash2 className="w-4 h-4" />
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <form id="episode-form" onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2 md:col-span-2">
              <Label>Episode Title</Label>
              <Input name="title" defaultValue={episode.title} readOnly={isViewer} required />
            </div>

            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={kind} onValueChange={(v: any) => setKind(v)} disabled={isViewer}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard Video/Text</SelectItem>
                  <SelectItem value="checklist">Action Checklist</SelectItem>
                  <SelectItem value="icp">ICP Questionnaire</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Video Embed URL or Upload</Label>
              <div className="flex gap-2">
                <Input
                  name="videoUrl"
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  placeholder="Paste YouTube/Vimeo/Loom URL, or upload an .mp4"
                  readOnly={isViewer}
                />
                {!isViewer && (
                  <>
                    <input
                      ref={videoFileRef}
                      type="file"
                      accept="video/mp4,video/webm,.mp4,.webm"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void handleVideoFile(f);
                      }}
                      data-testid="input-video-file"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => videoFileRef.current?.click()}
                      disabled={videoUploading}
                      data-testid="button-upload-video"
                    >
                      <Upload className="w-4 h-4 mr-2" />
                      {videoUploading ? "Uploading..." : "Upload"}
                    </Button>
                  </>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Embeds (YouTube/Vimeo/Loom) play in an iframe. Uploaded files (.mp4/.webm, up to 200MB) play in a native video player. For walkthroughs over 200MB, upload to Loom and paste the embed URL.
              </p>
            </div>
          </div>

          {kind === "icp" && (
            <div className="rounded-lg bg-primary/5 border border-primary/20 p-4 text-sm">
              <div className="font-semibold flex items-center gap-2 text-secondary">
                <ClipboardList className="w-4 h-4" /> ICP Questionnaire lesson
              </div>
              <p className="text-muted-foreground mt-1">
                Clients see the 34-question Ideal Customer Profile form embedded in this lesson. Submitting it
                automatically marks the lesson complete and notifies the operator.
              </p>
            </div>
          )}

          {kind !== "icp" && (
            <div className="space-y-2">
              <Label>Episode Copy / Content</Label>
              <Textarea
                name="copy"
                defaultValue={episode.copy}
                className="min-h-[200px]"
                readOnly={isViewer}
              />
            </div>
          )}

          {kind === "checklist" && (
            <div className="space-y-3 bg-muted/20 p-4 rounded-xl border">
              <div className="flex justify-between items-center">
                <Label>Checklist Items</Label>
                {!isViewer && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setChecklist([...checklist, { id: Date.now(), label: "", kind: "check" }])
                    }
                  >
                    <Plus className="w-3 h-3 mr-1" /> Add Row
                  </Button>
                )}
              </div>
              <div className="space-y-2">
                {checklist.map((item) => (
                  <div key={item.id} className="flex items-center gap-2">
                    <Input
                      value={item.label}
                      readOnly={isViewer}
                      onChange={(e) =>
                        setChecklist(
                          checklist.map((c) => (c.id === item.id ? { ...c, label: e.target.value } : c)),
                        )
                      }
                      placeholder="Checklist action item..."
                      className="flex-1"
                    />
                    <Select
                      value={item.kind ?? "check"}
                      onValueChange={(v: "check" | "url" | "text") =>
                        setChecklist(checklist.map((c) => (c.id === item.id ? { ...c, kind: v } : c)))
                      }
                      disabled={isViewer}
                    >
                      <SelectTrigger className="w-[140px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="check">Checkbox</SelectItem>
                        <SelectItem value="url">URL field</SelectItem>
                        <SelectItem value="text">Text field</SelectItem>
                      </SelectContent>
                    </Select>
                    {!isViewer && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => setChecklist(checklist.filter((c) => c.id !== item.id))}
                      >
                        <X className="w-4 h-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                ))}
                {checklist.length === 0 && (
                  <div className="text-sm text-muted-foreground italic">No checklist items added.</div>
                )}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-6 border-t pt-6">
            <div className="flex items-center gap-2">
              <input type="hidden" name="published" value={episode.published ? "true" : "false"} />
              <Switch
                defaultChecked={episode.published}
                onCheckedChange={(c) => {
                  if (!isViewer) {
                    const el = document.querySelector('input[name="published"]') as HTMLInputElement;
                    if (el) el.value = c ? "true" : "false";
                  }
                }}
                disabled={isViewer}
              />
              <Label>Published</Label>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="hidden"
                name="requirePrevious"
                value={episode.requirePrevious ? "true" : "false"}
              />
              <Switch
                defaultChecked={episode.requirePrevious}
                onCheckedChange={(c) => {
                  if (!isViewer) {
                    const el = document.querySelector(
                      'input[name="requirePrevious"]',
                    ) as HTMLInputElement;
                    if (el) el.value = c ? "true" : "false";
                  }
                }}
                disabled={isViewer}
              />
              <Label>Require Previous Completed</Label>
            </div>
          </div>

          {!isViewer && (
            <Button type="submit" size="lg">
              <Save className="w-4 h-4 mr-2" /> Save Episode
            </Button>
          )}
        </form>

        <div className="max-w-2xl mt-10">
          <EpisodeAssets episodeId={episode.id} isViewer={isViewer} />
        </div>
      </div>
    </div>
  );
}

function EpisodeAssets({ episodeId, isViewer }: { episodeId: number; isViewer: boolean }) {
  const [items, setItems] = useState<Array<{ id: number; name: string; sizeBytes: number; createdAt: string }>>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    try {
      const list = await api<Array<{ id: number; name: string; sizeBytes: number; createdAt: string }>>(
        `/admin/episodes/${episodeId}/assets`,
      );
      setItems(list);
    } catch {
      setItems([]);
    }
  };
  useEffect(() => {
    void refresh();
  }, [episodeId]);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const up = await uploadFile(file);
      await api(`/admin/episodes/${episodeId}/assets`, { method: "POST", json: up });
      toast.success("Asset uploaded");
      await refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      toast.error(msg);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async (id: number) => {
    try {
      await api(`/admin/episodes/assets/${id}`, { method: "DELETE" });
      await refresh();
    } catch {
      toast.error("Could not delete");
    }
  };

  return (
    <div className="space-y-3 border-t pt-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold flex items-center gap-2">
          <Paperclip className="w-4 h-4" /> Assets
        </h3>
        {!isViewer && (
          <Button size="sm" type="button" onClick={() => inputRef.current?.click()} disabled={busy}>
            <Upload className="w-4 h-4 mr-2" /> {busy ? "Uploading…" : "Upload"}
          </Button>
        )}
        <input ref={inputRef} type="file" className="hidden" onChange={onPick} />
      </div>
      <p className="text-sm text-muted-foreground">
        Files attached here appear in the client's "Resources" section on this episode.
      </p>
      <div className="space-y-2">
        {items.length === 0 ? (
          <div className="text-sm text-muted-foreground italic py-4">No assets yet.</div>
        ) : (
          items.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between gap-3 p-3 rounded-lg border bg-background"
            >
              <a
                href={`/api/admin/files/asset/${a.id}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-3 min-w-0 flex-1 hover:underline"
              >
                <FileIcon className="w-4 h-4 text-primary shrink-0" />
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate">{a.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {(a.sizeBytes / 1024).toFixed(1)} KB · {new Date(a.createdAt).toLocaleString()}
                  </div>
                </div>
              </a>
              {!isViewer && (
                <Button variant="ghost" size="icon" onClick={() => remove(a.id)} aria-label="Delete asset">
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
