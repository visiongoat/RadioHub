import React, { useState, useEffect, useCallback, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Upload, Star, Globe, Loader2, Zap, Check, AlertCircle, Radio, Sparkles, Languages } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiAuthHeaders, resolveApiUrl } from "@/lib/queryClient";
import { buildDescriptionChanges, generateAdminStationDescription } from '@/lib/admin-station-description';

const httpUrl = (value: string) => {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
};
const optionalHttpUrl = z.string().trim().max(4096).refine(value => !value || httpUrl(value), 'Enter a valid HTTP or HTTPS URL').optional();
export const stationFormSchema = z.object({
  name: z.string().trim().min(1, "Station name is required").max(4096),
  url: z.string().trim().max(4096).refine(httpUrl, "Enter a valid HTTP or HTTPS stream URL"),
  urlResolved: optionalHttpUrl,
  homepage: optionalHttpUrl,
  favicon: z.string().trim().max(4096).optional(),
  countryCode: z.string().optional(),
  country: z.string().optional(),
  state: z.string().optional(),
  codec: z.string().optional(),
  bitrate: z.number().int().min(0).max(100000).nullable().optional(),
  tags: z.string().optional(),
  hls: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
  showInGlobalPopular: z.boolean().optional(),
  noIndex: z.boolean().optional(),
  descriptionsJson: z.string().optional(),
});

interface StationData {
  _id?: string;
  slug?: string;
  id?: string;
  name: string;
  url: string;
  urlResolved?: string;
  homepage?: string;
  countryCode?: string;
  state?: string;
  codec?: string;
  bitrate?: number;
  tags?: string;
  isActive?: boolean;
  country?: any;
  favicon?: string;
  hls?: boolean;
  lastCheckOk?: boolean;
  isFeatured?: boolean;
  showInGlobalPopular?: boolean;
  noIndex?: boolean;
  redirectToSlug?: string | null;
  descriptions?: Record<string, any>;
}

type StationFormData = z.infer<typeof stationFormSchema>;

interface StationFormProps {
  station?: StationData;
  open: boolean;
  onClose: () => void;
  onSubmit: (data: StationFormData) => void;
  isLoading?: boolean;
}

interface CountryOption {
  name: string;
  code: string;
}

interface GenreOption {
  _id: string;
  name: string;
  slug: string;
  stationCount?: number;
}

// A record/open-session key isolates drafts and asynchronous callbacks when
// an administrator switches stations or closes/reopens the same record.
export default function StationForm(props: StationFormProps) {
  return <StationFormSession key={`${props.station?._id || props.station?.id || 'new'}:${props.open}`} {...props} />;
}

function StationFormSession({
  station,
  open,
  onClose,
  onSubmit,
  isLoading = false,
}: StationFormProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [redirectTargetDraft, setRedirectTargetDraft] = useState<string | null>(null);
  const [redirectError, setRedirectError] = useState<string | null>(null);
  const redirectRequest = useRef(false);
  const redirectInputId = React.useId();
  const [isUploadingFavicon, setIsUploadingFavicon] = useState(false);
  const [isAnalyzingStream, setIsAnalyzingStream] = useState(false);
  const [streamAnalysis, setStreamAnalysis] = useState<any>(null);
  const [activeTab, setActiveTab] = useState("basic");
  const baseline = useRef<StationData | undefined>(station);
  const wasOpen = useRef(false);
  const mounted = useRef(true);
  const analysisRequest = useRef(0);
  const faviconInput = useRef<HTMLInputElement>(null);
  const stationId = station?._id || station?.id;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; analysisRequest.current++; };
  }, []);

  const { data: countriesData } = useQuery<CountryOption[]>({
    queryKey: ['/api/admin/available-countries'],
    queryFn: () => api.getAvailableCountries(),
    enabled: open,
  });

  const { data: genresData } = useQuery<{ genres: GenreOption[] }>({
    queryKey: ['/api/genres'],
    queryFn: () => api.getGenres(),
    enabled: open,
  });

  const genres = genresData?.genres || [];
  const countries = countriesData || [];

  const getDefaultValues = (station?: any) => ({
    name: station?.name || "",
    url: station?.url || "",
    urlResolved: station?.urlResolved || "",
    homepage: station?.homepage || "",
    favicon: station?.favicon || "",
    countryCode: station?.countryCode || "",
    country: typeof station?.country === 'string' ? station.country : station?.country?.name || station?.countryName || "",
    state: station?.state || "",
    codec: station?.codec || "",
    bitrate: station?.bitrate ?? null,
    tags: station?.tags || "",
    hls: station?.hls ?? false,
    isFeatured: station?.isFeatured ?? false,
    showInGlobalPopular: station?.showInGlobalPopular ?? false,
    noIndex: station?.noIndex ?? false,
    descriptionsJson: station?.descriptions ? JSON.stringify(station.descriptions, null, 2) : "",
  });

  const form = useForm<StationFormData>({
    resolver: zodResolver(stationFormSchema),
    defaultValues: getDefaultValues(station),
  });

  const { data: freshStation, isFetching: isLoadingStation, isFetchedAfterMount: hasLoadedStation, isError: stationLoadFailed, refetch: reloadStation } = useQuery({
    queryKey: ['/api/admin/stations', stationId || 'new'],
    queryFn: async ({ signal }) => {
      const data = await (await apiRequest('GET', `/api/admin/stations/${stationId}`, { signal })).json();
      if (!data || (data._id || data.id) !== stationId) throw new Error('The station response did not match the requested record');
      return data as StationData;
    },
    enabled: !!stationId && open,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const redirectMutation = useMutation({
    mutationFn: (body: { targetSlug: string | null; expectedRedirectToSlug: string | null }) =>
      apiRequest('PUT', `/api/admin/stations/${stationId}/redirect`, { body }),
    retry: false,
    onError: (error: Error) => {
      if (!mounted.current) return;
      setRedirectError(error.message || 'The redirect could not be confirmed. Review the current target before retrying.');
    },
    onSettled: async (_data, error, body) => {
      // Reload after both success and failure: a conflict or lost response
      // can mean the saved redirect differs from the value we last observed.
      try {
        await queryClient.invalidateQueries({ queryKey: ['/api/admin/stations'] });
      } finally {
        redirectRequest.current = false;
      }
      if (!mounted.current || error) return;
      setRedirectTargetDraft(null);
      toast({
        title: body.targetSlug ? 'Redirect saved' : 'Redirect cleared',
        description: 'Station records, favorites, listening history, indexing settings and stream health were preserved.',
      });
    },
  });

  const generateAiMutation = useMutation({
    mutationFn: generateAdminStationDescription,
    onSuccess: (data) => {
      if (!mounted.current) return;
      if (data.descriptions) {
        baseline.current = { ...baseline.current!, descriptions: data.descriptions };
        form.resetField('descriptionsJson', { defaultValue: JSON.stringify(data.descriptions, null, 2) });
      }
      toast({
        title: "AI Description Generated",
        description: "The description in the station's language was saved and reloaded",
      });
    },
    onError: (error: any) => {
      if (!mounted.current) return;
      toast({
        title: "Generation Failed",
        description: error.message || "Could not generate AI descriptions",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    const alreadyOpen = wasOpen.current;
    wasOpen.current = open;
    if (open) {
      const dataToUse = freshStation || station;
      if (alreadyOpen && form.formState.isDirty) return;
      baseline.current = dataToUse;
      form.reset(getDefaultValues(dataToUse));
      setStreamAnalysis(null);
      if (!alreadyOpen) setActiveTab("basic");
    }
  }, [station, open, form, freshStation]);

  const analyzeStreamUrl = useCallback(async (url: string) => {
    if (!url || !httpUrl(url)) return;
    const requestId = ++analysisRequest.current;
    const isCurrent = () => mounted.current && requestId === analysisRequest.current && form.getValues('url') === url;
    
    setIsAnalyzingStream(true);
    try {
      const result = await api.analyzeStreamUrl(url);
      if (!isCurrent()) return;
      setStreamAnalysis(result);
      
      if (result.codec && !form.getValues('codec')) {
        form.setValue('codec', result.codec, { shouldDirty: true, shouldValidate: true });
      }
      if (result.bitrate && !form.getValues('bitrate')) {
        form.setValue('bitrate', result.bitrate, { shouldDirty: true, shouldValidate: true });
      }
      if (typeof result.hls === 'boolean') {
        form.setValue('hls', result.hls, { shouldDirty: true });
      }
    } catch {
      if (isCurrent()) setStreamAnalysis({ success: false });
    } finally {
      if (mounted.current && requestId === analysisRequest.current) setIsAnalyzingStream(false);
    }
  }, [form]);

  const handleSubmit = (data: StationFormData) => {
    try {
      const { changes, descriptions } = buildDescriptionChanges(data.descriptionsJson || '', baseline.current?.descriptions || {});
      const { descriptionsJson: _json, ...fields } = data;
      // Only an explicit indexing edit may set the manual policy, including
      // on creation. Merely displaying the default must not write noIndex.
      if (!form.getFieldState('noIndex').isDirty) delete fields.noIndex;
      if (!station) return onSubmit({ ...fields, ...(Object.keys(descriptions).length ? { descriptions } : {}) } as any);
      const defaults = getDefaultValues(baseline.current);
      const changed: Record<string, unknown> = Object.fromEntries(Object.entries(fields).filter(([key, value]) => value !== (defaults as any)[key]));
      if (changes.length) {
        if (!baseline.current?.slug) throw new Error('Reload the station before editing descriptions.');
        changed.descriptionPatch = { slug: baseline.current.slug, changes };
      }
      onSubmit(changed as any);
    } catch (error) {
      form.setError('descriptionsJson', { message: error instanceof Error ? error.message : 'Invalid descriptions' });
      setActiveTab('ai');
    }
  };

  const handleCountryChange = (countryName: string) => {
    if (countryName === '__unknown__') {
      form.setValue('country', '', { shouldDirty: true, shouldValidate: true });
      form.setValue('countryCode', '', { shouldDirty: true });
      return;
    }
    const selectedCountry = countries.find(c => c.name === countryName);
    if (selectedCountry) {
      form.setValue('country', selectedCountry.name, { shouldDirty: true, shouldValidate: true });
      form.setValue('countryCode', selectedCountry.code, { shouldDirty: true });
    }
  };

  const handleGenreSelect = (genreSlug: string) => {
    const currentTags = form.getValues('tags') || '';
    const tagsArray = currentTags.split(',').map(t => t.trim()).filter(Boolean);
    
    if (!tagsArray.includes(genreSlug)) {
      tagsArray.push(genreSlug);
      form.setValue('tags', tagsArray.join(', '), { shouldDirty: true });
    }
  };

  const removeTag = (tagToRemove: string) => {
    const currentTags = form.getValues('tags') || '';
    const tagsArray = currentTags.split(',').map(t => t.trim()).filter(t => t && t !== tagToRemove);
    form.setValue('tags', tagsArray.join(', '), { shouldDirty: true });
  };

  const currentTags = (form.watch('tags') || '').split(',').map(t => t.trim()).filter(Boolean);
  const descriptions = baseline.current?.descriptions || {};
  const descriptionCount = Object.keys(descriptions).length;
  const busy = isLoading || generateAiMutation.isPending || isUploadingFavicon || redirectMutation.isPending;
  const waitingForFreshStation = Boolean(stationId && !freshStation && isLoadingStation);
  const currentRedirect = freshStation?.redirectToSlug || null;
  const redirectTarget = redirectTargetDraft ?? currentRedirect ?? '';
  const redirectReady = Boolean(stationId && freshStation && hasLoadedStation && !isLoadingStation && !stationLoadFailed);
  const saveRedirect = (targetSlug: string | null) => {
    if (!redirectReady || busy || redirectRequest.current) return;
    redirectRequest.current = true;
    setRedirectError(null);
    redirectMutation.mutate({ targetSlug, expectedRedirectToSlug: currentRedirect });
  };

  return (
    <Dialog open={open} onOpenChange={nextOpen => { if (!nextOpen && !busy) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-white border border-gray-200 shadow-lg text-gray-900">
        <DialogHeader className="pb-2">
          <DialogTitle className="text-gray-900 flex items-center gap-2">
            <Radio className="w-5 h-5 text-blue-600" />
            {station ? 'Edit Station' : 'Add New Station'}
          </DialogTitle>
          <DialogDescription>Update this station's metadata and translations. Stream availability is verified separately.</DialogDescription>
        </DialogHeader>

        {waitingForFreshStation && <p role="status" className="text-sm text-gray-600">Loading latest station details…</p>}
        {stationLoadFailed && <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Latest station details could not be loaded. Retry before saving.
          <Button type="button" variant="outline" size="sm" className="ml-2" onClick={() => void reloadStation()}>Retry</Button>
        </div>}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit, errors => setActiveTab(errors.descriptionsJson && Object.keys(errors).length === 1 ? 'ai' : 'basic'))} className="space-y-4">
            
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-2 h-9">
                <TabsTrigger value="basic" className="text-sm">
                  <Radio className="w-4 h-4 mr-1.5" />
                  Station Info
                </TabsTrigger>
                <TabsTrigger value="ai" className="text-sm">
                  <Sparkles className="w-4 h-4 mr-1.5" />
                  AI & Translations
                  {descriptionCount > 0 && (
                    <Badge variant="secondary" className="ml-1.5 text-xs px-1.5">{descriptionCount}</Badge>
                  )}
                </TabsTrigger>
              </TabsList>

              {/* Basic Info Tab */}
              <TabsContent value="basic" className="space-y-4 mt-4">
                
                {/* Station Name */}
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Station Name *</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Enter station name" className="text-gray-900" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Stream URL with Auto-Detect */}
                <FormField
                  control={form.control}
                  name="url"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Stream URL *</FormLabel>
                      <div className="flex gap-2">
                        <FormControl>
                          <Input 
                            {...field} 
                            placeholder="https://stream.example.com/radio" 
                            className="text-gray-900"
                            onBlur={(e) => {
                              field.onBlur();
                              if (e.target.value) {
                                analyzeStreamUrl(e.target.value);
                              }
                            }}
                          />
                        </FormControl>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={isAnalyzingStream || !field.value}
                          onClick={() => analyzeStreamUrl(field.value)}
                          className="shrink-0"
                          title="Auto-detect stream info"
                          aria-label="Analyze stream URL"
                        >
                          {isAnalyzingStream ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Zap className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                      {streamAnalysis && (
                        <div className="flex items-center gap-2 mt-1 text-xs">
                          {streamAnalysis.success ? (
                            <>
                              <Check className="h-3 w-3 text-green-600" />
                              <span className="text-green-700">
                                {streamAnalysis.streamType}
                                {streamAnalysis.codec && ` • ${streamAnalysis.codec}`}
                                {streamAnalysis.bitrate && ` • ${streamAnalysis.bitrate}kbps`}
                              </span>
                            </>
                          ) : (
                            <>
                              <AlertCircle className="h-3 w-3 text-yellow-600" />
                              <span className="text-yellow-700">Could not detect stream info</span>
                            </>
                          )}
                        </div>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField control={form.control} name="urlResolved" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Resolved stream URL</FormLabel>
                    <FormControl><Input {...field} value={field.value || ''} placeholder="Optional direct playback URL" className="text-gray-900" /></FormControl>
                    <FormDescription className="text-xs">Leave empty to use the main stream URL. Changing the main URL clears an unchanged old resolved URL.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />

                {/* Country & State - Side by Side */}
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="country"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Country</FormLabel>
                        <Select value={field.value || '__unknown__'} onValueChange={handleCountryChange}>
                          <FormControl>
                            <SelectTrigger className="text-gray-900">
                              <SelectValue placeholder="Select country" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent className="max-h-[250px] bg-white">
                            <SelectItem value="__unknown__">Unknown / not verified</SelectItem>
                            {countries.map((country) => (
                              <SelectItem key={country.code} value={country.name}>
                                {country.name} ({country.code})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="state"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>State/Region</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="Optional" className="text-gray-900" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Codec & Bitrate - Side by Side */}
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="codec"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Codec</FormLabel>
                        <Select value={field.value || ""} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger className="text-gray-900">
                              <SelectValue placeholder="Auto-detect" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent className="bg-white">
                            <SelectItem value="MP3">MP3</SelectItem>
                            <SelectItem value="AAC">AAC</SelectItem>
                            <SelectItem value="AAC+">AAC+</SelectItem>
                            <SelectItem value="OGG">OGG Vorbis</SelectItem>
                            <SelectItem value="OPUS">Opus</SelectItem>
                            <SelectItem value="FLAC">FLAC</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="bitrate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Bitrate (kbps)</FormLabel>
                        <FormControl>
                          <Input 
                            {...field} 
                            type="number" 
                            placeholder="Auto-detect"
                            value={field.value ?? ""}
                            min={0}
                            max={100000}
                            onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)}
                            className="text-gray-900"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Genre Selection */}
                <div className="space-y-2">
                  <FormLabel>Genres/Tags</FormLabel>
                  <Select onValueChange={handleGenreSelect}>
                    <SelectTrigger className="text-gray-900">
                      <SelectValue placeholder="Add genre" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[250px] bg-white">
                      {genres.map((genre) => (
                        <SelectItem key={genre._id} value={genre.slug}>
                          {genre.name} {genre.stationCount ? `(${genre.stationCount})` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  
                  {currentTags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {currentTags.map((tag) => (
                        <button key={tag} type="button" onClick={() => removeTag(tag)} aria-label={`Remove genre ${tag}`}>
                        <Badge
                          variant="secondary" 
                          className="cursor-pointer hover:bg-red-100 hover:text-red-700 text-xs"
                        >
                          {tag} ×
                        </Badge>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Favicon & Homepage - Side by Side */}
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="favicon"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Logo URL</FormLabel>
                        <div className="flex gap-1.5">
                          {field.value && (
                            <img 
                              key={field.value}
                              src={field.value} 
                              alt="" 
                              className="w-9 h-9 rounded object-cover border shrink-0"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            />
                          )}
                          <FormControl>
                            <Input {...field} value={field.value || ""} placeholder="Logo URL" className="text-gray-900" />
                          </FormControl>
                          <input
                            type="file"
                            ref={faviconInput}
                            accept="image/*,.svg,image/svg+xml"
                            className="hidden"
                            aria-label="Upload station logo file"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              const input = e.currentTarget;
                              if (!stationId) {
                                toast({ title: "Error", description: "Save station first", variant: "destructive" });
                                return;
                              }
                              
                              setIsUploadingFavicon(true);
                              const previousFavicon = form.getValues('favicon');
                              try {
                                const formData = new FormData();
                                formData.append('favicon', file);
                                const endpoint = `/api/admin/stations/${stationId}/upload-favicon`;
                                const response = await fetch(resolveApiUrl(endpoint), {
                                  method: 'POST', credentials: 'include', headers: apiAuthHeaders(endpoint), body: formData,
                                });
                                if (!response.ok) throw new Error('Upload failed');
                                const result = await response.json();
                                if (result.success !== true || typeof result.favicon !== 'string' || !result.favicon) throw new Error('The uploaded logo could not be confirmed');
                                if (!mounted.current) return;
                                // Upload already persists the favicon. Refresh only this
                                // baseline field; never resend it as an unrelated edit.
                                baseline.current = { ...baseline.current!, favicon: result.favicon };
                                if (form.getValues('favicon') === previousFavicon) form.resetField('favicon', { defaultValue: result.favicon });
                                toast({ title: "Logo uploaded", description: result.warning || "The station logo was saved" });
                              } catch (error: any) {
                                if (mounted.current) toast({ title: "Failed", description: error.message, variant: "destructive" });
                              } finally {
                                if (mounted.current) setIsUploadingFavicon(false);
                                input.value = '';
                              }
                            }}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busy || !stationId || waitingForFreshStation || stationLoadFailed}
                            onClick={() => faviconInput.current?.click()}
                            aria-label="Upload station logo"
                            className="shrink-0"
                          >
                            {isUploadingFavicon ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                          </Button>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="homepage"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Homepage</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="https://..." className="text-gray-900" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Featured Station Toggles */}
                <div className="flex flex-wrap items-center gap-6 p-3 border rounded-lg bg-gray-50">
                  <FormField
                    control={form.control}
                    name="isFeatured"
                    render={({ field }) => (
                      <FormItem className="flex items-center gap-2 space-y-0">
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                        <FormLabel className="flex items-center gap-1 cursor-pointer">
                          <Star className="h-4 w-4 text-yellow-500" />
                          Popular
                        </FormLabel>
                      </FormItem>
                    )}
                  />

                  {form.watch("isFeatured") && (
                    <FormField
                      control={form.control}
                      name="showInGlobalPopular"
                      render={({ field }) => (
                        <FormItem className="flex items-center gap-2 space-y-0">
                          <FormControl>
                            <Switch checked={field.value} onCheckedChange={field.onChange} />
                          </FormControl>
                          <FormLabel className="flex items-center gap-1 cursor-pointer">
                            <Globe className="h-4 w-4 text-blue-500" />
                            Global
                          </FormLabel>
                        </FormItem>
                      )}
                    />
                  )}
                </div>

                <FormField
                  control={form.control}
                  name="noIndex"
                  render={({ field }) => (
                    <FormItem className="rounded-lg border p-3">
                      <div className="flex items-center justify-between gap-4">
                        <FormLabel className="cursor-pointer">Allow search engine indexing</FormLabel>
                        <FormControl>
                          <Switch
                            checked={!field.value}
                            onCheckedChange={allowed => field.onChange(!allowed)}
                            onBlur={field.onBlur}
                            ref={field.ref}
                            disabled={busy || waitingForFreshStation || stationLoadFailed}
                          />
                        </FormControl>
                      </div>
                      <FormDescription>
                        {field.value ? 'Indexing is disabled by this setting.' : 'Indexing is allowed by this setting.'}
                        {' '}Save to apply changes. Page quality and duplicate checks still apply; this does not change stream availability or guarantee search engine indexing.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {stationId && <section className="space-y-3 rounded-lg border p-3" aria-labelledby={`${redirectInputId}-heading`}>
                  <h4 id={`${redirectInputId}-heading`} className="text-sm font-medium">Duplicate redirect</h4>
                  <p className="text-sm text-gray-600" aria-live="polite">
                    Current canonical target: <span className="font-medium text-gray-900">{hasLoadedStation && freshStation ? currentRedirect || 'None' : 'Loading…'}</span>
                  </p>
                  <div className="space-y-2">
                    <label htmlFor={redirectInputId} className="text-sm font-medium">Canonical station slug</label>
                    <Input
                      id={redirectInputId}
                      value={redirectTarget}
                      placeholder="canonical-station-slug"
                      disabled={busy || !redirectReady}
                      aria-describedby={`${redirectInputId}-help`}
                      onChange={event => setRedirectTargetDraft(event.target.value)}
                      onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }}
                    />
                  </div>
                  <p id={`${redirectInputId}-help`} className="text-sm text-gray-500">
                    Send this duplicate's visitors to an existing indexable station with the same name and stream.
                    The canonical station must have full and meta descriptions in all 14 supported station languages.
                    Both station records, favorites and listening history are kept. Indexing settings and stream health stay unchanged.
                    Clearing removes only the redirect from the saved record immediately; previously cached public redirects may persist for up to 5 minutes.
                    Use the buttons below to save this separately.
                  </p>
                  {redirectError && <p role="alert" className="text-sm text-red-700">{redirectError}</p>}
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm"
                      disabled={busy || !redirectReady || !redirectTarget.trim() || redirectTarget.trim() === currentRedirect}
                      onClick={() => saveRedirect(redirectTarget.trim())}>
                      {redirectMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Save redirect
                    </Button>
                    <Button type="button" variant="outline" size="sm"
                      disabled={busy || !redirectReady || !currentRedirect}
                      onClick={() => saveRedirect(null)}>
                      Clear redirect
                    </Button>
                  </div>
                </section>}
              </TabsContent>

              {/* AI & Translations Tab */}
              <TabsContent value="ai" className="space-y-4 mt-4">
                
                {/* AI Generation Button */}
                {stationId && (
                  <div className="flex items-center justify-between p-4 border rounded-lg bg-gradient-to-r from-purple-50 to-blue-50">
                    <div>
                      <h4 className="font-medium text-gray-900 flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-purple-600" />
                        AI Description Generator
                      </h4>
                      <p className="text-sm text-gray-600 mt-0.5">
                        Generate a description in the station's language
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy || isLoadingStation || stationLoadFailed || form.formState.isDirty}
                      onClick={() => generateAiMutation.mutate(stationId)}
                      className="bg-white"
                    >
                      {generateAiMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Sparkles className="h-4 w-4 mr-2" />
                      )}
                      Generate
                    </Button>
                  </div>
                )}

                {/* Current Translations Display */}
                {descriptionCount > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-gray-700 flex items-center gap-2">
                      <Languages className="h-4 w-4" />
                      Existing Translations ({descriptionCount} languages)
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.keys(descriptions).map((lang) => (
                        <Badge key={lang} variant="outline" className="text-xs">
                          {lang.toUpperCase()}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Descriptions JSON Editor */}
                <FormField
                  control={form.control}
                  name="descriptionsJson"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>AI Descriptions (JSON)</FormLabel>
                      <FormControl>
                        <Textarea 
                          {...field}
                          value={field.value || ""}
                          placeholder='{"en": {"full": "English description", "meta": "Short summary"}}'
                          rows={8}
                          className="font-mono text-xs text-gray-900"
                        />
                      </FormControl>
                      <FormDescription className="text-xs">
                        Edit multi-language descriptions as JSON. Keys are language codes (en, tr, de, etc.)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </TabsContent>
            </Tabs>

            {/* Submit Buttons */}
            <div className="flex justify-end gap-3 pt-3 border-t">
              <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || waitingForFreshStation || stationLoadFailed} className="bg-blue-600 hover:bg-blue-700">
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {station ? 'Save Changes' : 'Add Station'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
