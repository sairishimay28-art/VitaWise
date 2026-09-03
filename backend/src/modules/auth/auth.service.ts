import { Injectable, Logger, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { DatabaseService } from '../database/database.service';

export interface SignupDto {
  email: string;
  password: string;
  fullName: string;
  phone?: string;
  role?: 'patient' | 'doctor' | 'nutritionist' | 'admin';
  languagePreference?: 'en' | 'te' | 'hi';
}

export interface LoginDto {
  email: string;
  password: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly databaseService: DatabaseService,
  ) {}

  /**
   * Registers a user in Supabase Auth and seeds user records in public tables
   */
  async signup(dto: SignupDto) {
    const supabase = this.supabaseService.getClient();
    if (!supabase) {
      throw new BadRequestException('Supabase client is not configured.');
    }

    this.logger.log(`Registering new user with email: ${dto.email}`);

    // Create user in Supabase Auth via Admin API (pre-confirms email for reliable dev/demo flow)
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: dto.email,
      password: dto.password,
      email_confirm: true,
      user_metadata: {
        full_name: dto.fullName,
        phone: dto.phone,
        role: dto.role || 'patient',
      },
    });

    if (authError || !authData.user) {
      this.logger.error(`Supabase Auth signup error: ${authError?.message}`);
      throw new BadRequestException(authError?.message || 'Failed to create user in Supabase Auth');
    }

    const userId = authData.user.id;

    // Seed public tables: users, user_profiles, user_preferences
    try {
      await this.databaseService.query(
        `INSERT INTO public.users (id, email, phone, role, full_name, is_active)
         VALUES ($1, $2, $3, $4, $5, true)
         ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, role = EXCLUDED.role;`,
        [userId, dto.email, dto.phone || null, dto.role || 'patient', dto.fullName]
      );

      await this.databaseService.query(
        `INSERT INTO public.user_profiles (user_id, language_preference)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO NOTHING;`,
        [userId, dto.languagePreference || 'en']
      );

      await this.databaseService.query(
        `INSERT INTO public.user_preferences (user_id)
         VALUES ($1)
         ON CONFLICT (user_id) DO NOTHING;`,
        [userId]
      );
    } catch (dbErr: any) {
      this.logger.error(`Failed to seed public user tables: ${dbErr.message}`);
      // Proceed even if already seeded
    }

    // Now sign in to generate access session tokens
    const { data: sessionData, error: sessionError } = await supabase.auth.signInWithPassword({
      email: dto.email,
      password: dto.password,
    });

    return {
      success: true,
      user: {
        id: userId,
        email: dto.email,
        fullName: dto.fullName,
        role: dto.role || 'patient',
      },
      session: sessionData?.session ? {
        accessToken: sessionData.session.access_token,
        refreshToken: sessionData.session.refresh_token,
        expiresIn: sessionData.session.expires_in,
        tokenType: sessionData.session.token_type,
      } : null,
    };
  }

  /**
   * Authenticates user against Supabase Auth and returns JWT tokens + profile
   */
  async login(dto: LoginDto) {
    const supabase = this.supabaseService.getClient();
    if (!supabase) {
      throw new BadRequestException('Supabase client is not configured.');
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: dto.email,
      password: dto.password,
    });

    if (error || !data.user) {
      this.logger.warn(`Authentication failed for ${dto.email}: ${error?.message}`);
      throw new UnauthorizedException(error?.message || 'Invalid credentials');
    }

    // Fetch user details from public.users
    const userRes = await this.databaseService.query(
      `SELECT u.id, u.email, u.full_name, u.role, p.language_preference, p.pcos_diagnosed
       FROM public.users u
       LEFT JOIN public.user_profiles p ON p.user_id = u.id
       WHERE u.id = $1;`,
      [data.user.id]
    );

    const userProfile = userRes.rows[0] || {
      id: data.user.id,
      email: data.user.email,
      full_name: data.user.user_metadata?.full_name || 'VitaWise User',
      role: 'patient',
    };

    return {
      success: true,
      user: userProfile,
      session: {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: data.session.expires_at,
        expiresIn: data.session.expires_in,
        tokenType: data.session.token_type,
      },
    };
  }

  /**
   * Validates Supabase JWT Bearer token and returns authenticated user
   */
  async validateToken(token: string) {
    const supabase = this.supabaseService.getClient();
    if (!supabase) {
      throw new UnauthorizedException('Supabase client is not configured');
    }

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const userRes = await this.databaseService.query(
      `SELECT u.id, u.email, u.full_name, u.role, p.language_preference, p.pcos_diagnosed, p.dietary_preference
       FROM public.users u
       LEFT JOIN public.user_profiles p ON p.user_id = u.id
       WHERE u.id = $1;`,
      [data.user.id]
    );

    return userRes.rows[0] || {
      id: data.user.id,
      email: data.user.email,
      full_name: data.user.user_metadata?.full_name || 'VitaWise User',
      role: 'patient',
    };
  }

  /**
   * Refreshes user session
   */
  async refreshSession(refreshToken: string) {
    const supabase = this.supabaseService.getClient();
    if (!supabase) {
      throw new BadRequestException('Supabase client is not configured');
    }

    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error || !data.session) {
      throw new UnauthorizedException(error?.message || 'Failed to refresh session');
    }

    return {
      success: true,
      session: {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresIn: data.session.expires_in,
      },
    };
  }

  /**
   * Sign out / invalidate session
   */
  async logout(token?: string) {
    const supabase = this.supabaseService.getClient();
    if (supabase && token) {
      try {
        await supabase.auth.admin.signOut(token);
      } catch {
        // ignore logout warning
      }
    }
    return { success: true, message: 'Logged out successfully' };
  }
}
