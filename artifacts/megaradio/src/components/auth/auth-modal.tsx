import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";

const loginSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

const signupSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTab?: "login" | "signup";
  onSuccess?: () => void;
}

export default function AuthModal({ isOpen, onClose, defaultTab = "login", onSuccess }: AuthModalProps) {
  const [activeTab, setActiveTab] = useState(defaultTab);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  // Login form
  const loginForm = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  // Signup form
  const signupForm = useForm({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  });

  // Login mutation
  const loginMutation = useMutation({
    mutationFn: async (data: z.infer<typeof loginSchema>) => {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
        credentials: 'include',
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Login failed');
      }
      
      return response.json();
    },
    onSuccess: async (response) => {
      const user = response.user;
      const userName = user.fullName || user.username || user.email;
      toast({
        title: t('auth_welcome_back_toast'),
        description: `Successfully logged in as ${userName}`,
      });
      // Invalidate user queries to refresh auth state
      await queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] });
      // Close modal and call success callback immediately
      onClose();
      onSuccess?.();
    },
    onError: (error: Error) => {
      toast({
        title: t('auth_login_failed'),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Signup mutation
  const signupMutation = useMutation({
    mutationFn: async (data: z.infer<typeof signupSchema>) => {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fullName: data.name,
          email: data.email,
          password: data.password,
        }),
        credentials: 'include',
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Signup failed');
      }
      
      return response.json();
    },
    onSuccess: async (response) => {
      const user = response.user;
      const userName = user.fullName || user.username || user.email;
      toast({
        title: t('auth_account_created'),
        description: `Welcome ${userName}! Your account has been created successfully.`,
      });
      // Invalidate user queries to refresh auth state
      await queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] });
      // Close modal and call success callback immediately
      onClose();
      onSuccess?.();
    },
    onError: (error: Error) => {
      toast({
        title: t('auth_signup_failed'),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleLogin = (data: z.infer<typeof loginSchema>) => {
    loginMutation.mutate(data);
  };

  const handleSignup = (data: z.infer<typeof signupSchema>) => {
    signupMutation.mutate(data);
  };

  // Social login handler
  const handleSocialLogin = async (provider: 'google' | 'apple' | 'facebook') => {
    try {
      // Show connecting toast
      toast({
        title: t('auth_social_connecting'),
        description: `Connecting to ${provider}...`,
      });
      
      // Redirect to social auth endpoint
      window.location.href = `/api/auth/${provider}`;
    } catch (error) {
      toast({
        title: t('auth_social_error'),
        description: `Failed to connect with ${provider}. Please try again.`,
        variant: "destructive",
      });
    }
  };

  const handleClose = () => {
    loginForm.reset();
    signupForm.reset();
    setShowPassword(false);
    setShowConfirmPassword(false);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent 
        className="sm:max-w-md bg-[#1D1D1D] border-[#2F2F2F] text-white"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle className="text-center text-2xl font-bold">
            {activeTab === "login" ? t('auth_welcome_back') : t('auth_create_account')}
          </DialogTitle>
          <DialogDescription className="text-center text-gray-400">
            {activeTab === "login" ? t('auth_welcome_back_description') : t('auth_create_account_description')}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "login" | "signup")} className="w-full">
          <TabsList className="grid w-full grid-cols-2 bg-[#2F2F2F] mb-6">
            <TabsTrigger value="login" className="data-[state=active]:bg-[#FF4199] data-[state=active]:text-white">
              {t('auth_login')}
            </TabsTrigger>
            <TabsTrigger value="signup" className="data-[state=active]:bg-[#FF4199] data-[state=active]:text-white">
              {t('auth_sign_up')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="login" className="space-y-4">
            {/* Social Login Buttons */}
            <div className="space-y-4">
              <div className="text-center text-sm text-gray-400">
                {t('auth_continue_with')}
              </div>
              <div className="flex justify-center gap-3">
                {/* Google Button */}
                <button
                  onClick={() => handleSocialLogin('google')}
                  className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-[#404040] hover:border-[#666666] transition-colors"
                  title={t('auth_continue_google')}
                  data-testid="social-login-google"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                </button>

                {/* Facebook Button */}
                <button
                  onClick={() => handleSocialLogin('facebook')}
                  className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-[#404040] hover:border-[#666666] transition-colors"
                  title={t('auth_continue_facebook')}
                  data-testid="social-login-facebook"
                >
                  <svg className="h-5 w-5 text-[#1877F2]" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                  </svg>
                </button>

                {/* Apple Button */}
                <button
                  onClick={() => handleSocialLogin('apple')}
                  className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-[#404040] hover:border-[#666666] transition-colors"
                  title={t('auth_continue_apple')}
                  data-testid="social-login-apple"
                >
                  <svg className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"/>
                  </svg>
                </button>
              </div>
              
              <div className="relative">
                <Separator className="bg-[#404040]" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="bg-[#1D1D1D] px-2 text-xs text-gray-400">
                    {t('auth_or')}
                  </span>
                </div>
              </div>
            </div>

            <form 
              onSubmit={loginForm.handleSubmit(handleLogin)} 
              className="space-y-4"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="space-y-2">
                <Label htmlFor="login-email">{t('auth_email_label')}</Label>
                <Input
                  id="login-email"
                  type="email"
                  placeholder={t('auth_email_placeholder')}
                  className="bg-[#2F2F2F] border-[#404040] text-white placeholder:text-gray-400"
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  {...loginForm.register("email")}
                />
                {loginForm.formState.errors.email && (
                  <p className="text-sm text-red-400">{loginForm.formState.errors.email.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="login-password">{t('auth_password')}</Label>
                <div className="relative">
                  <Input
                    id="login-password"
                    type={showPassword ? "text" : "password"}
                    placeholder={t('auth_password_placeholder')}
                    className="bg-[#2F2F2F] border-[#404040] text-white placeholder:text-gray-400 pr-10"
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    {...loginForm.register("password")}
                  />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowPassword(!showPassword);
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {loginForm.formState.errors.password && (
                  <p className="text-sm text-red-400">{loginForm.formState.errors.password.message}</p>
                )}
              </div>

              <Button
                type="submit"
                className="w-full bg-[#FF4199] hover:bg-[#FF097B] text-white"
                disabled={loginMutation.isPending}
              >
                {loginMutation.isPending ? t('auth_logging_in') : t('auth_login')}
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="signup" className="space-y-4">
            {/* Social Login Buttons */}
            <div className="space-y-4">
              <div className="text-center text-sm text-gray-400">
                {t('auth_continue_with')}
              </div>
              <div className="flex justify-center gap-3">
                {/* Google Button */}
                <button
                  onClick={() => handleSocialLogin('google')}
                  className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-[#404040] hover:border-[#666666] transition-colors"
                  title={t('auth_continue_google')}
                  data-testid="social-signup-google"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                </button>

                {/* Facebook Button */}
                <button
                  onClick={() => handleSocialLogin('facebook')}
                  className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-[#404040] hover:border-[#666666] transition-colors"
                  title={t('auth_continue_facebook')}
                  data-testid="social-signup-facebook"
                >
                  <svg className="h-5 w-5 text-[#1877F2]" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                  </svg>
                </button>

                {/* Apple Button */}
                <button
                  onClick={() => handleSocialLogin('apple')}
                  className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-[#404040] hover:border-[#666666] transition-colors"
                  title={t('auth_continue_apple')}
                  data-testid="social-signup-apple"
                >
                  <svg className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"/>
                  </svg>
                </button>
              </div>
              
              <div className="relative">
                <Separator className="bg-[#404040]" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="bg-[#1D1D1D] px-2 text-xs text-gray-400">
                    {t('auth_or')}
                  </span>
                </div>
              </div>
            </div>

            <form 
              onSubmit={signupForm.handleSubmit(handleSignup)} 
              className="space-y-4"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="space-y-2">
                <Label htmlFor="signup-name">{t('auth_full_name')}</Label>
                <Input
                  id="signup-name"
                  type="text"
                  placeholder={t('auth_full_name_placeholder')}
                  className="bg-[#2F2F2F] border-[#404040] text-white placeholder:text-gray-400"
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  {...signupForm.register("name")}
                />
                {signupForm.formState.errors.name && (
                  <p className="text-sm text-red-400">{signupForm.formState.errors.name.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="signup-email">{t('auth_email_label')}</Label>
                <Input
                  id="signup-email"
                  type="email"
                  placeholder={t('auth_email_placeholder')}
                  className="bg-[#2F2F2F] border-[#404040] text-white placeholder:text-gray-400"
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  {...signupForm.register("email")}
                />
                {signupForm.formState.errors.email && (
                  <p className="text-sm text-red-400">{signupForm.formState.errors.email.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="signup-password">{t('auth_password')}</Label>
                <div className="relative">
                  <Input
                    id="signup-password"
                    type={showPassword ? "text" : "password"}
                    placeholder={t('auth_password_placeholder')}
                    className="bg-[#2F2F2F] border-[#404040] text-white placeholder:text-gray-400 pr-10"
                    {...signupForm.register("password")}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {signupForm.formState.errors.password && (
                  <p className="text-sm text-red-400">{signupForm.formState.errors.password.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="signup-confirm-password">{t('auth_confirm_password')}</Label>
                <div className="relative">
                  <Input
                    id="signup-confirm-password"
                    type={showConfirmPassword ? "text" : "password"}
                    placeholder={t('auth_confirm_password_placeholder')}
                    className="bg-[#2F2F2F] border-[#404040] text-white placeholder:text-gray-400 pr-10"
                    {...signupForm.register("confirmPassword")}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {signupForm.formState.errors.confirmPassword && (
                  <p className="text-sm text-red-400">{signupForm.formState.errors.confirmPassword.message}</p>
                )}
              </div>

              <Button
                type="submit"
                className="w-full bg-[#FF4199] hover:bg-[#FF097B] text-white"
                disabled={signupMutation.isPending}
              >
                {signupMutation.isPending ? t('auth_signing_up') : t('auth_create_account')}
              </Button>
            </form>
          </TabsContent>
        </Tabs>

        <div className="text-center text-sm text-gray-400 mt-4">
          {activeTab === "login" ? (
            <p>
              {t('auth_no_account')}{" "}
              <button
                onClick={() => setActiveTab("signup")}
                className="text-[#FF4199] hover:text-[#FF097B] underline"
              >
                {t('auth_sign_up_here')}
              </button>
            </p>
          ) : (
            <p>
              {t('auth_have_account')}{" "}
              <button
                onClick={() => setActiveTab("login")}
                className="text-[#FF4199] hover:text-[#FF097B] underline"
              >
                {t('auth_login_here')}
              </button>
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
